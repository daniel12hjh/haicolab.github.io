// Local-only instructor utility. Never deploy a service-role key to the browser.
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
const course=process.env.TEAM_COURSE||'sts2026';
if(!['sts2026','eng3510'].includes(course))throw Error('Unsupported course');
const {config}=await import(`../../courses/${course}/2026-fall/team-building/config.js`);
console.log(`Target course: ${course.toUpperCase()}`);

const rl=createInterface({input:process.stdin,output:process.stdout});
const email=(await rl.question('비밀번호를 재설정할 학생의 가입 이메일: ')).trim();
rl.close();
async function hidden(prompt){
 if(!process.stdin.isTTY)throw Error('대화형 터미널에서 실행해 주세요.');
 process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const handler=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){finish();reject(Error('취소되었습니다.'));return;}if(c==='\r'||c==='\n'){finish();resolve(value);return;}if(c==='\u007f'){value=value.slice(0,-1);}else if(c>=' ')value+=c;}};function finish(){process.stdin.off('data',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}process.stdin.on('data',handler);});
}
try{
 if(!email.includes('@'))throw Error('올바른 이메일을 입력해 주세요.');
 const key=await hidden('Supabase secret/service_role key (표시되지 않음): ');
 const password=await hidden('학생에게 개별 전달할 임시 비밀번호 (8자 이상, 표시되지 않음): ');
 if(password.length<8)throw Error('비밀번호는 8자 이상이어야 합니다.');
 const client=createClient(config.supabaseUrl,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.admin.listUsers({page:1,perPage:1000});if(error)throw error;
 const user=data.users.find(u=>u.email?.toLowerCase()===email.toLowerCase());if(!user)throw Error('가입된 사용자를 찾지 못했습니다.');
 const result=await client.auth.admin.updateUserById(user.id,{password});if(result.error)throw result.error;
 console.log('비밀번호를 변경했습니다. 학생에게 개별 전달하고, 로그인 후 내 활동에서 변경하도록 안내하세요.');
}catch(error){console.error(error.message);process.exitCode=1;}
