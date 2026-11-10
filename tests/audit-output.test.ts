/** @lane merge @subject src/audit-output.ts @subject src/cli.ts */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { admitOutput, auditArtifact, producerIdentity, publishAudit } from '../src/audit-output.ts';
import { scan, scanProject } from '../src/scan.ts';
import { renderMarkdown } from '../src/report.ts';
import { EvidenceReport } from '../src/schema.ts';
import { makeTree } from './helpers/tree.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args: string[]) => spawnSync(process.execPath,[join(ROOT,'scripts/tests.mjs'),...args],{encoding:'utf8',windowsHide:true,timeout:30000});
const io = {write:(fd:number,bytes:Buffer)=>writeFileSync(fd,bytes),link:linkSync,unlink:unlinkSync,rmdir:rmdirSync};
const hash=(text:Buffer|string)=>createHash('sha256').update(text).digest('hex');
const source=(text='same\n')=>makeTree({'package.json':JSON.stringify({name:'agent-tests',version:'1.2.3'}),'package-lock.json':JSON.stringify({version:'1.2.3',packages:{'':{version:'1.2.3'}}}),'src/identity.ts':text});

describe('stable audit artifacts',()=>{
  it('preserves default stdout and writes JSON with producer identity and exact byte receipt',()=>{
    const root=makeTree({'sentinel':'keep'}),before=cli('scan','--root',root);
    expect(before.status).toBe(0);expect(JSON.parse(before.stdout).artifact).toBeUndefined();
    const result=cli('scan','--root',root,'--out','scan.json');expect(result.status,result.stderr).toBe(0);
    const receipt=JSON.parse(result.stdout),bytes=readFileSync(join(root,'scan.json')),artifact=JSON.parse(bytes.toString());
    expect(receipt).toMatchObject({written:expect.any(String),bytes:bytes.length,sha256:hash(bytes)});
    expect(EvidenceReport.parse(artifact)).toEqual(JSON.parse(before.stdout));
    expect(artifact.artifact).toMatchObject({schema:'agent-tests/audit-output@1',root,command:'scan',producer:producerIdentity()});
    expect(readFileSync(join(root,'sentinel'),'utf8')).toBe('keep');
    const second=cli('scan','--root',root,'--out','scan2.json');expect(second.status).toBe(0);
    expect(readFileSync(join(root,'scan2.json'))).toEqual(bytes);
  });
  it('writes capped Markdown with unknown-runner limits; absolute destination is explicit',()=>{
    const root=makeTree(),dest=join(makeTree(),'report.md'),evidence=scan(root);
    expect(cli('report','--root',root).stdout).toBe(renderMarkdown(evidence));
    const result=cli('report','--root',root,'--out',dest,'--max-files','2','--max-per-rule','3');expect(result.status,result.stderr).toBe(0);
    const text=readFileSync(dest,'utf8');expect(text).toContain('zero static test count does not prove');
    expect(text).toContain('"maxFiles": 2');expect(text).toContain('"maxPerRule": 3');expect(text).toContain(producerIdentity().sourceFingerprint);
    expect(JSON.parse(result.stdout).sha256).toBe(hash(text));
  });
  it('identifies the same runtime independently of cache location and text line endings',()=>{
    const a=producerIdentity(source()),b=producerIdentity(source('same\r\n'));
    expect(a).toEqual(b);expect(producerIdentity(source('changed\n')).sourceFingerprint).not.toBe(a.sourceFingerprint);
    const evidence=scan(makeTree());expect(auditArtifact(evidence,'scan',{},a)).toBe(auditArtifact(evidence,'scan',{},b));
  });
  it('refuses inconsistent producer versions',()=>{
    const s=source();writeFileSync(join(s,'package.json'),JSON.stringify({name:'agent-tests',version:'2.0.0'}));
    expect(()=>producerIdentity(s)).toThrow(/mismatch/);
  });
  it('rejects unsupported commands and empty output paths before writing',()=>{
    const root=makeTree();
    for(const command of ['capabilities','risk-draft','worktree-check'])expect(cli(command,'--root',root,'--out','x').status).toBe(2);
    expect(cli('scan','--root',root,'--out','').status).toBe(2);expect(readdirSync(root)).toEqual([]);
  });
  it('preserves existing files and directories, including invalid-root and malformed-risk failures',()=>{
    const root=makeTree({'kept.md':'owned','.testing/risk.yml':'phase: invalid\n'});
    expect(cli('report','--root',root,'--out','new.md').status).toBe(1);expect(existsSync(join(root,'new.md'))).toBe(false);
    const result=cli('report','--root',root,'--out','kept.md');expect(JSON.parse(result.stderr).error.code).toBe('E_EXISTS');
    expect(readFileSync(join(root,'kept.md'),'utf8')).toBe('owned');
    expect(()=>admitOutput(root,'.testing')).toThrow(/already exists/);
    expect(cli('scan','--root',join(root,'missing'),'--out','new.json').status).toBe(2);
  });
  it('requires an existing parent and creates no directories on refusal',()=>{
    const root=makeTree();const result=cli('scan','--root',root,'--out','missing/output.json');
    expect(result.status).toBe(1);expect(JSON.parse(result.stderr).error.code).toBe('E_OUTPUT');expect(readdirSync(root)).toEqual([]);
  });
  it('refuses dangling symlink destinations when supported',ctx=>{
    const root=makeTree(),target=join(root,'link');
    try{symlinkSync(join(root,'absent'),target);}catch(error){if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??'')){ctx.skip('symlink creation unavailable');return;}throw error;}
    expect(()=>admitOutput(root,'link')).toThrow(/already exists/);expect(existsSync(join(root,'absent'))).toBe(false);
  });
  it('keeps a concurrent destination intact and removes only its owned stage',()=>{
    const root=makeTree(),target=admitOutput(root,'out');
    expect(()=>publishAudit(target,'audit',{...io,link:(from,to)=>{writeFileSync(to,'concurrent',{flag:'wx'});linkSync(from,to);}})).toThrow(/already exists/);
    expect(readFileSync(target,'utf8')).toBe('concurrent');expect(readdirSync(root)).toEqual(['out']);
  });
  it('never publishes partial staged bytes or falls back when hard links fail',()=>{
    for(const fault of ['write','link']){
      const root=makeTree(),target=admitOutput(root,'out');
      const fail={...io,...(fault==='write'?{write:(fd:number)=>{writeFileSync(fd,'partial');throw Object.assign(Error('full'),{code:'ENOSPC'});}}:{link:()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'});}})};
      expect(()=>publishAudit(target,'complete',fail)).toThrow(/publication failed/);expect(readdirSync(root)).toEqual([]);
    }
  });
  it('reports retained staging when a concurrent destination and cleanup failure coincide',()=>{
    const root=makeTree(),target=admitOutput(root,'out');
    expect(()=>publishAudit(target,'audit',{...io,link:(from,to)=>{writeFileSync(to,'concurrent',{flag:'wx'});linkSync(from,to);},unlink:()=>{throw Error('cleanup denied');}})).toThrow(/owned staging retained/);
    expect(readFileSync(target,'utf8')).toBe('concurrent');
  });
  it('reports published bytes accurately when stage cleanup fails',()=>{
    const root=makeTree(),target=admitOutput(root,'out');
    const result=publishAudit(target,'complete',{...io,unlink:()=>{throw Error('cleanup denied');}});
    expect(readFileSync(target,'utf8')).toBe('complete');expect(result.sha256).toBe(hash('complete'));expect(result.cleanupWarnings?.length).toBeGreaterThan(0);
    expect(result.staging).toContain('.agent-tests-output-');
  });
  it('accepts an explicitly selected parent directory alias without replacing content',()=>{
    const root=makeTree(),actual=makeTree(),alias=join(root,'alias');symlinkSync(actual,alias,process.platform==='win32'?'junction':'dir');
    const result=publishAudit(admitOutput(root,'alias/out'),'complete');expect(readFileSync(join(actual,'out'),'utf8')).toBe('complete');expect(result.sha256).toBe(hash('complete'));
  });
  it.each([
    {name:'JavaScript with no known runner and an unsupported Python file',languages:[['JavaScript','unknown',10,'supported'],['Python','unknown',1,'detected-unsupported']],warns:true},
    {name:'a supported language with a known runner and files',languages:[['JavaScript','unknown',10,'supported'],['Python','pytest',2,'supported']],warns:false},
    {name:'a supported language with a known runner but no files',languages:[['JavaScript','unknown',0,'supported'],['Python','pytest',0,'supported']],warns:true},
  ] as const)('keeps the unknown-runner warning by inventory: $name',({languages,warns})=>{
    const evidence=EvidenceReport.parse({...scan(makeTree()),inventory:{complete:false,languages:languages.map(([language,runner,files,status])=>({language,runner,files,status})),notes:[]}});
    const warning='No supported runner detected; a zero static test count does not prove that the project has no tests.';
    expect(auditArtifact(evidence,'report').includes(warning)).toBe(warns);
    expect(JSON.parse(auditArtifact(evidence,'scan')).artifact.limits.includes(warning)).toBe(warns);
  });
  it('keeps the warning for 10 JavaScript tests with no runner config beside one Python test',async()=>{
    const files:Record<string,string>={'tests/test_x.py':'def test_x():\n    assert True\n'};
    for(let i=0;i<10;i++)files[`tests/t${i}.test.js`]='it("x",()=>{expect(1).toBe(1);});\n';
    const evidence=await scanProject(makeTree(files),{commitLimit:1});
    expect(evidence.runner).toBe('unknown');expect(evidence.inventory?.languages[0]).toMatchObject({language:'JavaScript',runner:'unknown',files:10,status:'supported'});
    expect(auditArtifact(evidence,'report')).toContain('> No supported runner detected');
    expect(JSON.parse(auditArtifact(evidence,'scan')).artifact.limits).toContain('No supported runner detected; a zero static test count does not prove that the project has no tests.');
  });
});
