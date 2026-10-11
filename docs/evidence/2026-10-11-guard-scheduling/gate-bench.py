import hashlib,json,os,pathlib,platform,re,subprocess,sys,time
root=pathlib.Path('/Users/dionalmaer/code/keel'); out=pathlib.Path('/tmp/keel-phase70'); label=sys.argv[1]
assert re.fullmatch(r'[a-z0-9-]+',label)
assert not (out/(label+'.json')).exists() and not (out/(label+'-check.log')).exists(), 'preserve existing observations'
def command(args): return subprocess.check_output(args,cwd=root,text=True).strip()
paths=['package.json','.keel/keel.json','tests/climb-guard.test.mjs','tests/climb-guard-state.test.mjs','tests/climb-guard-history.test.mjs']
record={'label':label,'head':command(['git','rev-parse','HEAD']),'node':command(['node','--version']),'machine':platform.platform(),'cpus':os.cpu_count(),'startLoad':os.getloadavg(),'startedUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'command':['npm','run','check'],'sourceHashes':{p:hashlib.sha256((root/p).read_bytes()).hexdigest() if (root/p).exists() else None for p in paths},'workingDiffHash':hashlib.sha256(subprocess.check_output(['git','diff','HEAD','--'],cwd=root)).hexdigest()}
started=time.monotonic()
with (out/(label+'-check.log')).open('w') as log: result=subprocess.run(record['command'],cwd=root,stdout=log,stderr=subprocess.STDOUT)
record.update(wallSeconds=time.monotonic()-started,exitCode=result.returncode,endLoad=os.getloadavg(),endedUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
(out/(label+'.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record));sys.exit(result.returncode)
