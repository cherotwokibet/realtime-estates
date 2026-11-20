from pathlib import Path
import json,hashlib,zipfile,subprocess,os,re,shutil
root=Path.cwd(); evidence=root/'docs/evidence'
review=json.loads((evidence/'2026-11-20-android469-workspace.json').read_text(encoding='utf-8'))
apk=Path(review['directory'])/'apps/mobile/android/app/build/outputs/apk/release/app-release.apk'
log=(evidence/'2026-11-20-android469-build.txt').read_text(encoding='utf-8')
assert 'BUILD SUCCESSFUL' in log and 'BUILD FAILED' not in log
assert apk.is_file() and apk.stat().st_size>1000000
sdk=Path(r'C:\Users\BONIFACE\AppData\Local\Android\Sdk\build-tools\35.0.0')
env={**os.environ,'JAVA_HOME':r'C:\Users\BONIFACE\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2'}
def execute(args,name):
 p=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',env=env)
 (evidence/name).write_text(p.stdout+p.stderr,encoding='utf-8')
 assert p.returncode==0,name
 return p.stdout+p.stderr
badging=execute([str(sdk/'aapt.exe'),'dump','badging',str(apk)],'2026-11-20-android469-badging.txt')
cert=execute(['cmd','/d','/c',str(sdk/'apksigner.bat'),'verify','--verbose','--print-certs',str(apk)],'2026-11-20-android469-signature.txt')
assert "package: name='com.boniface.realtor.preview.realtime.estates'" in badging
assert 'application-debuggable' not in badging
assert "native-code: 'arm64-v8a'" in badging
assert 'Verifies' in cert and 'CN=Android Debug' in cert
with zipfile.ZipFile(apk) as z:
 names=z.namelist()
 abis=sorted({n.split('/')[1] for n in names if n.startswith('lib/') and n.endswith('.so')})
 assert abis==['arm64-v8a']
 bundle='assets/index.android.bundle';assert bundle in names and z.getinfo(bundle).file_size>100000
 bundle_bytes=z.getinfo(bundle).file_size;bundleData=z.read(bundle);assert b'Prepare demo enquiry' in bundleData and b'Review draft in Profile' in bundleData;header=bundleData[:8].hex();assert header=='c61fbc03c103191f','Hermes bytecode header'
 configs=[n for n in names if n.endswith('/app.config')];assert len(configs)==1
 config=json.loads(z.read(configs[0]));extra=config.get('extra',{})
 assert extra.get('tenantSlug')=='realtime-estates' and 'nativeFirebase' not in extra and 'mobileReference' not in extra
 assert config['android']['package']=='com.boniface.realtor.preview.realtime.estates'
 assert not any(n.endswith(('.keystore','.jks','.p12')) or 'native-gateway-preload' in n for n in names)
sha=hashlib.sha256(apk.read_bytes()).hexdigest()
folder=root/'.staging-artifacts/deliverables';folder.mkdir(exist_ok=True)
final=folder/('realtor-preview-arm64-'+sha[:12]+'.apk')
if final.exists():assert hashlib.sha256(final.read_bytes()).hexdigest()==sha
else:
 with final.open('xb') as f,apk.open('rb') as src:shutil.copyfileobj(src,f)
checksum=final.with_suffix('.apk.sha256');line=sha+'  '+final.name+'\n'
if checksum.exists():assert checksum.read_text()==line
else:checksum.write_text(line,encoding='ascii')
cert_sha=re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)',cert)
assert cert_sha
receipt=dict(checkpoint=469,sourceCommit='2cbe28776a027de8eb8550ed6f7f7ce81a992ee7',artifact=str(final),sha256=sha,bytes=final.stat().st_size,abi=abis,packageId=config['android']['package'],appName=config['name'],version=config['version'],minSdk=int(re.search(r"sdkVersion:'(\d+)'",badging)[1]),targetSdk=int(re.search(r"targetSdkVersion:'(\d+)'",badging)[1]),signatureVerified=True,debugSigning=True,certificateSha256=cert_sha[1],releaseMode=True,androidDebuggable=False,embeddedHermesBundle=True,hermesHeader=header,bundleBytes=bundle_bytes,hostedAccountModeEnabled=False,localDraftFlowLabelsPackaged=True,deviceInstalled=False,deviceUiVerified=False,readyAdbDevices=0,systemJavaChanged=False,billingChanged=False,generatedNativeCacheRoot=str(root.parent/'_native468'))
(evidence/'2026-11-20-android469-artifact.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps(receipt,indent=2))
