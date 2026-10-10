# Local synthetic-only process-lifetime supervisor. This is not a token, ACL,
# filesystem, network, CPU or native-memory sandbox. Invoke this fixed file with
# a fresh coordinator environment and -NoLogo -NoProfile -NonInteractive -File.
# No worker is started until its Job Object association is atomic and verified.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace Realtor.LocalMedia
{
    public sealed class SupervisorResult
    {
        [JsonPropertyName("state")] public string State { get; set; }
        [JsonPropertyName("termination")] public string Termination { get; set; }
        [JsonPropertyName("exitCode")] public uint? ExitCode { get; set; }
        [JsonPropertyName("activeProcesses")] public uint? ActiveProcesses { get; set; }
        [JsonPropertyName("safeCode")] public string SafeCode { get; set; }
    }

    internal sealed class Configuration
    {
        internal string ExecutablePath;
        internal string[] Arguments;
        internal string WorkingDirectory;
        internal int TimeoutMs;
        internal uint MaxProcesses;
    }

    internal sealed class SafeFailure : Exception
    {
        internal readonly string Code;
        internal SafeFailure(string code) { Code = code; }
    }

    public static class WindowsSupervisor
    {
        private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectBasicAccountingInformation = 1;
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint HANDLE_FLAG_INHERIT = 0x00000001;
        private const uint WAIT_OBJECT_0 = 0;
        private const uint WAIT_TIMEOUT = 258;
        private const uint WAIT_FAILED = 0xffffffff;
        private const int TerminationVerificationMs = 5000;
        private const int DirectExitAccountingSettleMs = 250;
        private const uint StopExitCode = 0xe0000001;
        // ProcThreadAttributeValue(13, false, true, false), Windows 10+.
        private static readonly UIntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST = new UIntPtr(0x0002000d);

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            internal long PerProcessUserTimeLimit;
            internal long PerJobUserTimeLimit;
            internal uint LimitFlags;
            internal UIntPtr MinimumWorkingSetSize;
            internal UIntPtr MaximumWorkingSetSize;
            internal uint ActiveProcessLimit;
            internal UIntPtr Affinity;
            internal uint PriorityClass;
            internal uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            internal ulong ReadOperationCount;
            internal ulong WriteOperationCount;
            internal ulong OtherOperationCount;
            internal ulong ReadTransferCount;
            internal ulong WriteTransferCount;
            internal ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            internal IO_COUNTERS IoInfo;
            internal UIntPtr ProcessMemoryLimit;
            internal UIntPtr JobMemoryLimit;
            internal UIntPtr PeakProcessMemoryUsed;
            internal UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        {
            internal long TotalUserTime;
            internal long TotalKernelTime;
            internal long ThisPeriodTotalUserTime;
            internal long ThisPeriodTotalKernelTime;
            internal uint TotalPageFaultCount;
            internal uint TotalProcesses;
            internal uint ActiveProcesses;
            internal uint TotalTerminatedProcesses;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            internal uint cb;
            internal IntPtr lpReserved;
            internal IntPtr lpDesktop;
            internal IntPtr lpTitle;
            internal uint dwX;
            internal uint dwY;
            internal uint dwXSize;
            internal uint dwYSize;
            internal uint dwXCountChars;
            internal uint dwYCountChars;
            internal uint dwFillAttribute;
            internal uint dwFlags;
            internal ushort wShowWindow;
            internal ushort cbReserved2;
            internal IntPtr lpReserved2;
            internal IntPtr hStdInput;
            internal IntPtr hStdOutput;
            internal IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct STARTUPINFOEX
        {
            internal STARTUPINFO StartupInfo;
            internal IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            internal IntPtr hProcess;
            internal IntPtr hThread;
            internal uint dwProcessId;
            internal uint dwThreadId;
        }

        [DllImport("kernel32.dll", EntryPoint = "CreateJobObjectW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(IntPtr job, int informationClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool QueryInformationJobObject(IntPtr job, int informationClass,
            out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information, uint length, out uint returnedLength);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref UIntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute,
            IntPtr value, UIntPtr size, IntPtr previousValue, IntPtr returnedSize);
        [DllImport("kernel32.dll")]
        private static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcess(string applicationName, StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags,
            IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo,
            out PROCESS_INFORMATION processInformation);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        // This method only reports managed/native structure sizes; it launches
        // nothing and can be called during compile-only binding review.
        public static string DescribeBindings()
        {
            return JsonSerializer.Serialize(new {
                pointerSize = IntPtr.Size,
                startupInfoSize = Marshal.SizeOf<STARTUPINFO>(),
                startupInfoExSize = Marshal.SizeOf<STARTUPINFOEX>(),
                processInformationSize = Marshal.SizeOf<PROCESS_INFORMATION>(),
                basicLimitSize = Marshal.SizeOf<JOBOBJECT_BASIC_LIMIT_INFORMATION>(),
                extendedLimitSize = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>(),
                accountingSize = Marshal.SizeOf<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>()
            });
        }

        public static string Run()
        {
            Configuration config;
            try
            {
                if (!OperatingSystem.IsWindows() || IntPtr.Size != 8)
                    throw new SafeFailure("UNSUPPORTED_PLATFORM");
                config = ParseConfiguration(ReadBoundedLine(Console.In, 16384));
            }
            catch (SafeFailure failure)
            {
                // No native launch has been attempted in configuration parsing.
                return JsonSerializer.Serialize(Result("failed", "job_empty", null, 0, failure.Code));
            }
            catch
            {
                return JsonSerializer.Serialize(Result("failed", "job_empty", null, 0, "INVALID_CONFIGURATION"));
            }
            try
            {
                // Console.In is a synchronized reader. Its async methods may
                // block synchronously; a dedicated task keeps the monitor free.
                Task<string> control = Task.Run(() => ReadBoundedLine(Console.In, 64));
                return JsonSerializer.Serialize(Execute(config, control));
            }
            catch
            {
                // An unexpected failure outside Execute's recovery cannot prove
                // empty membership. In particular, never downgrade it to a
                // pre-launch validation failure merely because no receipt exists.
                return JsonSerializer.Serialize(Result("containment_unknown", "unconfirmed", null, null, "SUPERVISOR_FAILED"));
            }
        }

        private static SupervisorResult Execute(Configuration config, Task<string> control)
        {
            IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero;
            IntPtr jobList = IntPtr.Zero, environment = IntPtr.Zero;
            PROCESS_INFORMATION process = new PROCESS_INFORMATION();
            bool attributesInitialized = false;
            Stopwatch deadline = Stopwatch.StartNew();
            try
            {
                job = CreateJobObject(IntPtr.Zero, null); // unnamed, non-inheritable
                if (job == IntPtr.Zero) throw new SafeFailure("JOB_CREATE_FAILED");
                if (!SetHandleInformation(job, HANDLE_FLAG_INHERIT, 0))
                    throw new SafeFailure("JOB_HANDLE_FAILED");
                var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                // No BREAKAWAY_OK or SILENT_BREAKAWAY_OK; no memory/CPU claim.
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                limits.BasicLimitInformation.ActiveProcessLimit = config.MaxProcesses;
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                    ref limits, (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
                    throw new SafeFailure("JOB_LIMITS_FAILED");

                UIntPtr attributeSize = UIntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
                if (attributeSize.ToUInt64() == 0 || attributeSize.ToUInt64() > 65536)
                    throw new SafeFailure("ATTRIBUTE_SETUP_FAILED");
                attributes = Marshal.AllocHGlobal(checked((int)attributeSize.ToUInt64()));
                if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref attributeSize))
                    throw new SafeFailure("ATTRIBUTE_SETUP_FAILED");
                attributesInitialized = true;
                jobList = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobList, job);
                if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                    jobList, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                    throw new SafeFailure("ATOMIC_JOB_SETUP_FAILED");

                environment = CreateEnvironment();
                var startup = new STARTUPINFOEX();
                startup.StartupInfo.cb = (uint)Marshal.SizeOf<STARTUPINFOEX>();
                startup.lpAttributeList = attributes;
                SupervisorResult early = CheckControl(control, job, process.hProcess);
                if (early != null) return early;
                if (deadline.ElapsedMilliseconds >= config.TimeoutMs)
                    return StopAndConfirm(job, process.hProcess, "timed_out", "WALL_TIMEOUT");

                var commandLine = new StringBuilder(BuildCommandLine(config));
                uint flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW;
                // No inherited handles, STARTF_USESTDHANDLES or child console.
                // JOB_LIST associates the new process before its first thread runs.
                if (!CreateProcess(config.ExecutablePath, commandLine, IntPtr.Zero, IntPtr.Zero,
                    false, flags, environment, config.WorkingDirectory, ref startup, out process))
                    throw new SafeFailure("PROCESS_CREATE_FAILED");
                bool member;
                if (!IsProcessInJob(process.hProcess, job, out member) || !member)
                    throw new SafeFailure("JOB_MEMBERSHIP_FAILED");
                early = CheckControl(control, job, process.hProcess);
                if (early != null) return early;
                if (deadline.ElapsedMilliseconds >= config.TimeoutMs)
                    return StopAndConfirm(job, process.hProcess, "timed_out", "WALL_TIMEOUT");
                if (ResumeThread(process.hThread) != 1)
                    throw new SafeFailure("PROCESS_RESUME_FAILED");

                while (true)
                {
                    early = CheckControl(control, job, process.hProcess);
                    if (early != null) return early;
                    if (deadline.ElapsedMilliseconds >= config.TimeoutMs)
                        return StopAndConfirm(job, process.hProcess, "timed_out", "WALL_TIMEOUT");
                    uint wait = WaitForSingleObject(process.hProcess, 20);
                    if (wait == WAIT_FAILED) throw new SafeFailure("PROCESS_WAIT_FAILED");
                    if (wait == WAIT_OBJECT_0)
                        return ConfirmDirectExit(job, process.hProcess, control, deadline, config.TimeoutMs);
                    if (wait != WAIT_TIMEOUT) throw new SafeFailure("PROCESS_WAIT_FAILED");
                }
            }
            catch (SafeFailure failure)
            {
                return StopAndConfirm(job, process.hProcess, "failed", failure.Code);
            }
            catch
            {
                return StopAndConfirm(job, process.hProcess, "failed", "SUPERVISOR_FAILED");
            }
            finally
            {
                // On an unknown outcome, last-handle close is only a fail-safe.
                // It never upgrades unconfirmed termination to job_empty.
                if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
                if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
                if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
                if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                if (job != IntPtr.Zero) CloseHandle(job);
            }
        }

        private static SupervisorResult ConfirmDirectExit(IntPtr job, IntPtr process,
            Task<string> control, Stopwatch deadline, int timeoutMs)
        {
            // A signalled direct-process handle can precede the decrement in
            // job accounting. Give that accounting a short bounded settle,
            // without extending the original wall deadline or ignoring cancel.
            // A nonzero sample alone is never an empty-job receipt.
            Stopwatch settle = Stopwatch.StartNew();
            while (true)
            {
                SupervisorResult cancelled = CheckControl(control, job, process);
                if (cancelled != null) return cancelled;
                if (deadline.ElapsedMilliseconds >= timeoutMs)
                    return StopAndConfirm(job, process, "timed_out", "WALL_TIMEOUT");
                uint active;
                if (!TryActive(job, out active))
                {
                    TerminateJobObject(job, StopExitCode);
                    return Unknown(process, null, "JOB_QUERY_FAILED");
                }
                if (active == 0)
                {
                    uint? code = ReadExitedCode(process);
                    if (!code.HasValue) return Unknown(process, 0, "EXIT_READ_FAILED");
                    return Result("exited", "job_empty", code, 0, "EXITED");
                }
                if (settle.ElapsedMilliseconds >= DirectExitAccountingSettleMs)
                    return StopAndConfirm(job, process, "failed", "DESCENDANTS_REMAINED");
                Thread.Sleep(10);
            }
        }

        private static SupervisorResult CheckControl(Task<string> control, IntPtr job, IntPtr process)
        {
            if (!control.IsCompleted) return null;
            if (control.IsFaulted || control.IsCanceled)
                return StopAndConfirm(job, process, "failed", "INVALID_CONTROL");
            string line = control.GetAwaiter().GetResult();
            if (line == null) return StopAndConfirm(job, process, "cancelled", "INPUT_CLOSED");
            if (line == "cancel") return StopAndConfirm(job, process, "cancelled", "CANCELLED");
            return StopAndConfirm(job, process, "failed", "INVALID_CONTROL");
        }

        private static SupervisorResult StopAndConfirm(IntPtr job, IntPtr process, string state, string safeCode)
        {
            if (job == IntPtr.Zero)
                return process == IntPtr.Zero ? Result(state, "job_empty", null, 0, safeCode)
                    : Unknown(process, null, "NO_JOB_HANDLE");
            // Keep the owned job handle open until actual accounting proves zero.
            bool terminateRequested = TerminateJobObject(job, StopExitCode);
            Stopwatch barrier = Stopwatch.StartNew();
            uint? lastActive = null;
            while (barrier.ElapsedMilliseconds < TerminationVerificationMs)
            {
                uint active;
                if (!TryActive(job, out active))
                    return Unknown(process, lastActive, "JOB_QUERY_FAILED");
                lastActive = active;
                uint wait = process == IntPtr.Zero ? WAIT_OBJECT_0 : WaitForSingleObject(process, 0);
                if (wait == WAIT_FAILED) return Unknown(process, lastActive, "PROCESS_WAIT_FAILED");
                if (active == 0 && wait == WAIT_OBJECT_0)
                {
                    uint? code = process == IntPtr.Zero ? (uint?)null : ReadExitedCode(process);
                    if (process != IntPtr.Zero && !code.HasValue)
                        return Unknown(process, 0, "EXIT_READ_FAILED");
                    return Result(state, "job_empty", code, 0,
                        terminateRequested ? safeCode : "TERMINATE_REQUEST_FAILED");
                }
                Thread.Sleep(20);
            }
            return Unknown(process, lastActive, "TERMINATION_UNCONFIRMED");
        }

        private static bool TryActive(IntPtr job, out uint active)
        {
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info;
            uint returned;
            bool success = QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
                out info, (uint)Marshal.SizeOf<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>(), out returned);
            active = success ? info.ActiveProcesses : 0;
            return success && returned == (uint)Marshal.SizeOf<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>();
        }

        private static uint? ReadExitedCode(IntPtr process)
        {
            uint value;
            return process != IntPtr.Zero && WaitForSingleObject(process, 0) == WAIT_OBJECT_0
                && GetExitCodeProcess(process, out value) ? (uint?)value : null;
        }

        private static SupervisorResult Unknown(IntPtr process, uint? active, string code)
        {
            return Result("containment_unknown", "unconfirmed", ReadExitedCode(process), active, code);
        }

        private static SupervisorResult Result(string state, string termination, uint? exitCode, uint? active, string code)
        {
            return new SupervisorResult { State = state, Termination = termination,
                ExitCode = exitCode, ActiveProcesses = active, SafeCode = code };
        }

        private static string ReadBoundedLine(TextReader reader, int maximum)
        {
            var line = new StringBuilder();
            while (true)
            {
                int value = reader.Read();
                if (value == -1) return line.Length == 0 ? null : throw new SafeFailure("INVALID_CONTROL");
                if (value == '\n')
                {
                    if (line.Length != 0 && line[line.Length - 1] == '\r') line.Length--;
                    string result = line.ToString();
                    if (Encoding.UTF8.GetByteCount(result) > maximum) throw new SafeFailure("INPUT_TOO_LARGE");
                    return result;
                }
                if (line.Length >= maximum) throw new SafeFailure("INPUT_TOO_LARGE");
                line.Append((char)value);
            }
        }

        private static Configuration ParseConfiguration(string source)
        {
            if (source == null) throw new SafeFailure("INVALID_CONFIGURATION");
            using (JsonDocument document = JsonDocument.Parse(source,
                new JsonDocumentOptions { MaxDepth = 4, CommentHandling = JsonCommentHandling.Disallow, AllowTrailingCommas = false }))
            {
                JsonElement root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object) throw new SafeFailure("INVALID_CONFIGURATION");
                var names = new HashSet<string>(StringComparer.Ordinal);
                foreach (JsonProperty property in root.EnumerateObject())
                    if (!names.Add(property.Name)) throw new SafeFailure("INVALID_CONFIGURATION");
                if (names.Count != 5 || !names.SetEquals(new[] {
                    "executablePath", "arguments", "workingDirectory", "timeoutMs", "maxProcesses" }))
                    throw new SafeFailure("INVALID_CONFIGURATION");
                string executable = GetString(root.GetProperty("executablePath"), 4096);
                string directory = GetString(root.GetProperty("workingDirectory"), 4096);
                ValidateLocalPath(executable, false);
                ValidateLocalPath(directory, true);
                if (!String.Equals(Path.GetFileName(executable), "node.exe", StringComparison.OrdinalIgnoreCase))
                    throw new SafeFailure("INVALID_CONFIGURATION");
                JsonElement array = root.GetProperty("arguments");
                if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() < 1 || array.GetArrayLength() > 64)
                    throw new SafeFailure("INVALID_CONFIGURATION");
                var arguments = new List<string>();
                foreach (JsonElement value in array.EnumerateArray()) arguments.Add(GetString(value, 4096));
                ValidateLocalPath(arguments[0], false);
                string extension = Path.GetExtension(arguments[0]);
                if (extension != ".mjs" && extension != ".js") throw new SafeFailure("INVALID_CONFIGURATION");
                int timeout = GetInteger(root.GetProperty("timeoutMs"));
                int maxProcesses = GetInteger(root.GetProperty("maxProcesses"));
                if (timeout < 1 || timeout > 120000 || (maxProcesses != 1 && maxProcesses != 4))
                    throw new SafeFailure("INVALID_CONFIGURATION");
                var config = new Configuration { ExecutablePath = executable, Arguments = arguments.ToArray(),
                    WorkingDirectory = directory, TimeoutMs = timeout, MaxProcesses = (uint)maxProcesses };
                if (BuildCommandLine(config).Length > 30000) throw new SafeFailure("INVALID_CONFIGURATION");
                return config;
            }
        }

        private static int GetInteger(JsonElement value)
        {
            if (value.ValueKind != JsonValueKind.Number) throw new SafeFailure("INVALID_CONFIGURATION");
            string source = value.GetRawText();
            foreach (char c in source) if (c < '0' || c > '9') throw new SafeFailure("INVALID_CONFIGURATION");
            int number;
            if (!value.TryGetInt32(out number)) throw new SafeFailure("INVALID_CONFIGURATION");
            return number;
        }

        private static string GetString(JsonElement value, int maximum)
        {
            if (value.ValueKind != JsonValueKind.String) throw new SafeFailure("INVALID_CONFIGURATION");
            string text = value.GetString();
            ValidateText(text, maximum);
            return text;
        }

        private static void ValidateText(string text, int maximum)
        {
            if (text == null || text.Length > maximum) throw new SafeFailure("INVALID_CONFIGURATION");
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (c < 32 || c == 127) throw new SafeFailure("INVALID_CONFIGURATION");
                if (Char.IsHighSurrogate(c))
                {
                    if (++i >= text.Length || !Char.IsLowSurrogate(text[i])) throw new SafeFailure("INVALID_CONFIGURATION");
                }
                else if (Char.IsLowSurrogate(c)) throw new SafeFailure("INVALID_CONFIGURATION");
            }
        }

        private static void ValidateLocalPath(string path, bool directory)
        {
            if (!Path.IsPathFullyQualified(path) || path.Length < 3 || path[1] != ':' || path[2] != '\\'
                || !String.Equals(Path.GetFullPath(path), path, StringComparison.OrdinalIgnoreCase)
                || (directory ? !Directory.Exists(path) : !File.Exists(path)))
                throw new SafeFailure("INVALID_CONFIGURATION");
        }

        private static IntPtr CreateEnvironment()
        {
            // Defense in depth: even an incorrectly launched supervisor does
            // not forward arbitrary environment secrets or NODE_OPTIONS.
            var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string name in new[] { "SystemRoot", "WINDIR", "PATH", "TEMP", "TMP" })
            {
                string value = Environment.GetEnvironmentVariable(name);
                if (String.IsNullOrEmpty(value))
                {
                    if (name == "PATH") continue;
                    throw new SafeFailure("ENVIRONMENT_INVALID");
                }
                ValidateText(value, 8192);
                variables.Add(name, value);
            }
            variables.Add("UV_THREADPOOL_SIZE", "1");
            var block = new StringBuilder();
            foreach (KeyValuePair<string, string> variable in variables)
                block.Append(variable.Key).Append('=').Append(variable.Value).Append('\0');
            block.Append('\0');
            return Marshal.StringToHGlobalUni(block.ToString());
        }

        private static string BuildCommandLine(Configuration config)
        {
            var command = new StringBuilder(Quote(config.ExecutablePath));
            foreach (string argument in config.Arguments) command.Append(' ').Append(Quote(argument));
            return command.ToString();
        }

        private static string Quote(string argument)
        {
            // Windows CRT quoting, including empty strings, quotes and trailing
            // backslashes. Always quote; never build a shell command.
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in argument)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') result.Append('\\', slashes * 2 + 1).Append('"');
                else result.Append('\\', slashes).Append(c);
                slashes = 0;
            }
            result.Append('\\', slashes * 2).Append('"');
            return result.ToString();
        }
    }
}
'@

try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop | Out-Null
} catch {
    [Console]::Out.WriteLine('{"state":"failed","termination":"job_empty","exitCode":null,"activeProcesses":0,"safeCode":"SUPERVISOR_UNAVAILABLE"}')
    exit 0
}

try {
    [Console]::Out.WriteLine([Realtor.LocalMedia.WindowsSupervisor]::Run())
} catch {
    # No exception detail, paths, native error text or credentials enter protocol.
    # This outer boundary cannot prove what happened to a native worker.
    [Console]::Out.WriteLine('{"state":"containment_unknown","termination":"unconfirmed","exitCode":null,"activeProcesses":null,"safeCode":"SUPERVISOR_UNAVAILABLE"}')
}
exit 0
