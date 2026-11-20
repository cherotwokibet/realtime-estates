"""Owned synthetic emulator UI evidence helper. No personal devices/profiles/accounts."""
import subprocess,sys,json,datetime,hashlib,re
from pathlib import Path
import xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[2]
out=root/'.staging-artifacts/android470-ui';out.mkdir(parents=True,exist_ok=True)
adb=Path('C:/Users/BONIFACE/AppData/Local/Android/Sdk/platform-tools/adb.exe')
serial='emulator-5580';package='com.boniface.realtor.preview.realtime.estates'
def run(*args,timeout=30):
 p=subprocess.run([str(adb),'-s',serial,*args],capture_output=True,timeout=timeout)
 with (out/'trace.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'args':args,'exit':p.returncode,'stderr':p.stderr.decode('utf-8',errors='replace')[:1000]})+'\n')
 if p.returncode:raise RuntimeError(p.stderr.decode('utf-8',errors='replace'))
 return p.stdout
act=sys.argv[1]
if act=='state':
 print(run('shell','getprop','sys.boot_completed').decode());sys.exit()
name=run('emu','avd','name').decode().splitlines()[0].strip()
assert name=='RealtorReview470',f'Refusing unrelated emulator: {name}'
if act=='install':
 apk=root/'.staging-artifacts/deliverables/realtor-preview-arm64-a3e829ef708c.apk'
 assert hashlib.sha256(apk.read_bytes()).hexdigest()=='a3e829ef708cd0397de354ce142367e3c19dbe1b29de6402258f6ad9e45179a7'
 print(run('install',str(apk),timeout=180).decode())
elif act=='install-x86':
 meta=json.loads((root/'docs/evidence/2026-11-21-android470-x86-artifact.json').read_text(encoding='utf-8'))
 apk=Path(meta['apk']['path']).resolve();assert apk.is_relative_to((root/'.staging-artifacts/deliverables').resolve())
 assert hashlib.sha256(apk.read_bytes()).hexdigest()==meta['apk']['sha256']
 print(run('install','-r',str(apk),timeout=180).decode())
elif act in ['launch','resume']:
 print(run('shell','am','start','-W','-n',package+'/'+package+'.MainActivity',timeout=120).decode())
elif act=='home': print(run('shell','input','keyevent','KEYCODE_HOME').decode())
elif act=='tap':
 xml=ET.fromstring((out/'latest.xml').read_bytes());needle=sys.argv[2]
 matches=[n for n in xml.iter('node') if n.get('text')==needle or n.get('content-desc')==needle]
 assert len(matches)==1,f'Expected one exact visible target {needle}: {len(matches)}'
 vals=list(map(int,re.findall(r'\d+',matches[0].get('bounds',''))));assert len(vals)==4
 print(run('shell','input','tap',str((vals[0]+vals[2])//2),str((vals[1]+vals[3])//2)).decode())
elif act=='dump':
 label=sys.argv[2];assert re.fullmatch('[a-z0-9-]+',label)
 run('shell','uiautomator','dump','--compressed','/sdcard/realtor470.xml',timeout=60)
 data=run('exec-out','cat','/sdcard/realtor470.xml');ET.fromstring(data)
 (out/'latest.xml').write_bytes(data);(out/(label+'.xml')).write_bytes(data)
 shot=run('exec-out','screencap','-p');assert shot.startswith(b'\x89PNG');(out/(label+'.png')).write_bytes(shot)
 for n in ET.fromstring(data).iter('node'):
  if n.get('text') or n.get('content-desc'): print(json.dumps({k:n.get(k) for k in ['text','content-desc','bounds','clickable','package']},ensure_ascii=True))
else: raise ValueError('Unknown owned-device action')
