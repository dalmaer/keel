// Read-only historical source verification; requires an existing explicit review read receipt.
import {writeFile,mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyLearningSources} from '../../lib/evaluated-learning-sources.mjs';
const selection={selector:{kind:'github-review',repo:'dalmaer/plates',prNumber:216,reviewId:5608933935,threadId:'PRRT_kwDOU5nJK86vCWGO',commentId:4344271993,reviewedHead:'edfc56476dd4b7880d8bba83a13436b5a3887a5a',expectedBodySha256:'2937fdd40c340bab9b66ca0da37d5932fe85e1dcad09e748e6c4cdb30a1d999f'},classification:{value:'reviewer-statement',attribution:'manual',actor:'Codex',rationale:'Historical reviewer observation; no present defect or acceptance inferred.'}};
const result=await verifyLearningSources({selections:[selection],publicText:'Historical package entry compatibility lesson preparation.'});
const directory=await realpath(await mkdtemp(join(tmpdir(),'plates-learning-source-')));
await writeFile(join(directory,'source-observation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({directory,source:result.sources[0].id,reviewedHead:result.sources[0].source.reviewedHead,currentPrHead:result.sources[0].source.currentPrHead,coversCurrent:result.sources[0].source.reviewCoversCurrentHead,classification:result.sources[0].classification.value,incidentKey:result.sources[0].incidentKey}));
