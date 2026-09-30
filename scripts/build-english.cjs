// Builds English pages from the preserved Korean comparison copy.
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
const names = {cho:'Soyoung Cho (조소영)',lee:'Seowoo Lee (이서우)',nam:'Goeun Nam (남고은)',kim:'Hyunjae Kim (김현재)',heo:'Yoonseok Heo (허윤석)'};
const news = {
 '2026.10.07|Paper / Award': `<b>${names.cho}</b> received a <b>Best Paper Award</b> for an oral presentation at <b>HCLT 2026</b>: Evaluating Agents’ Regulatory Retrieval Using a Synthetic Benchmark Based on Broadcast Review Violations.<span class="original-title" lang="ko">방송심의 위반 사례 기반 합성 벤치마크를 활용한 에이전트 규정 검색 평가</span>`,
 '2026.09.11|Award': `Team <b>Sogang renAIssance</b> (${names.nam}, ${names.cho}, ${names.lee}, ${names.kim}, and ${names.heo}) received a <b>Merit Award</b> at the <a href="https://contest.sogang.ac.kr/" target="_blank" rel="noopener">2026 Sogang AI Driven University Idea Fair</a> for a Librarian–AI Collaboration Agent for Library Classification Decisions. <a href="https://github.com/HAICoLab/sogang_renAIssance/tree/main" target="_blank" rel="noopener">Code ↗</a>`,
 '2026.09.07|Project': `Launched an ETRI-funded project on an <em>Integrated Framework for Automated Broadcast and Media Metadata Construction and Knowledge Structuring from Public Web Information</em> (September–November 2026).`,
 '2026.09.01|Teaching': `Fall 2026 classes begin: <a href="teaching.html">Linguistics with AI, Data Analysis for AI, and Understanding and Using Generative AI</a>.`,
 '2026.09.01|Join': `Welcome <b>Tran Thanh Ngan</b>, who joined HAICoLab as a graduate student.`,
 '2026.07.01|Join': `Welcome <b>Ikramova Sevinch</b>, who joined HAICoLab as a graduate student.`,
 '2026.06.26|Award': `<b>${names.lee}</b> and <b>${names.nam}</b> received an <b>Outstanding Undergraduate Paper Award (Encouragement Prize)</b> at <b>KCC 2026</b> for their LLM-based analysis of narrative function transitions in Hemingway’s short stories and their alignment with literary criticism.<span class="original-title" lang="ko">헤밍웨이 단편 소설에 대한 LLM 기반 서사 기능 전이 패턴 분석과 문학 비평의 정합성 검증</span>`,
 '2026.03|Teaching': `Introduced <a href="teaching.html">Introduction to Data-Centric AI for Language Technology</a> for undergraduate and graduate students in Spring 2026.`,
 '2026.01.19|Join': `Welcome our four undergraduate research interns: <b>${names.cho}, ${names.nam}, ${names.lee}, and ${names.kim}</b>.`,
 '2026.01.14|Paper': `The technical report for KT’s Korean-focused LLM, <a href="https://arxiv.org/abs/2601.09066" target="_blank" rel="noopener"><b>Mi:dm 2.0 Korea-centric Bilingual Language Models</b></a>, is now available on arXiv. Co-author: ${names.heo}.`
};
const research = {
 knowledge: {
  eyebrow:'Research 01 · Language Understanding and Knowledge-Centric AI',
  question:'How can we build AI-ready knowledge while preserving the meaning and evidence in domain documents?',
  body:'We extract concepts, relationships, and conditions from documents and organize them into knowledge resources linked to their sources. By designing knowledge representations alongside retrieval and reasoning methods, we build foundations for AI that supports human judgment and work in specialized domains.',
  focus:['Our current work structures laws and regulations governing broadcast content production and evaluates regulatory retrieval. We plan to extend these methods to knowledge structuring and question answering over financial documents.'],
  subtitle:'Language understanding and AI-ready knowledge',
  overview:'We study language understanding and the construction of domain knowledge that AI can retrieve, connect, and use in reasoning.'
 },
 pluralism: {
  eyebrow:'Research 02 · AI Across Cultures and Perspectives',
  question:'How can AI understand cultural context and reflect diverse perspectives throughout its reasoning?',
  body:'We connect humanistic understanding of culture and social context with AI training and evaluation. We examine how models understand and reason about diverse cultures and values, with the aim of supporting collaboration with people from different backgrounds.',
  focus:['We analyze and evaluate how large reasoning models (LRMs) interpret cultural contexts and form judgments.','By examining model-generated reasoning, we identify where cultural context is omitted or distorted and develop training and evaluation methods to address these issues. Process reward modeling is one representative approach.'],
  subtitle:'AI across cultures and perspectives',
  overview:'We study AI that understands diverse cultures and values, examining and improving how cultural context shapes its reasoning and responses.'
 },
 creativity: {
  eyebrow:'Research 03 · Human–AI Co-Creation',
  question:'How can AI’s narrative planning capabilities help people turn their ideas into compelling works?',
  body:'We develop generative models, agents, and interaction methods that support idea exploration, plot design, expression, and revision. Focusing initially on storytelling and writing, we aim to advance AI’s creative capabilities while enabling people to shape the creative process.',
  focus:['Our first goal is to design convincing plot twists while maintaining foreshadowing and causal coherence. Building on this capability, we study collaborative writing environments in which novice writers and the public can explore and revise plots that reflect their intentions.'],
  subtitle:'Human–AI co-creation',
  overview:'We develop AI that helps people explore possibilities and transform their ideas and creative intentions into accomplished works.'
 },
 learning: {
  eyebrow:'Research 04 · AI for Language Learning and Assessment',
  question:'How can AI assessment and feedback improve learners’ actual language abilities?',
  body:'We study the validity and consistency of assessment, the usefulness of feedback, and learning outcomes in L2 English speaking and writing. Our goal is adaptive scaffolding that responds to learners’ proficiency and progress as they practice and revise.',
  focus:['We develop personalized feedback and methods for evaluating and validating AI-based assessment. Beyond improving individual pieces of work, we focus on helping learners develop the ability to perform independently.'],
  subtitle:'AI for language learning and assessment',
  overview:'We evaluate language performance and provide personalized feedback to help learners improve their speaking and writing abilities.'
 }
};
function set(doc, selector, value, html=false) { const el=doc.querySelector(selector); if(!el)throw Error('Missing '+selector);el[html?'innerHTML':'textContent']=value; }
function languagePicker(file, english) {
 const kr = (english ? '../' : '') + file;
 const en = (english ? '' : 'en/') + file;
 return `<div class="language-picker"><button class="language-toggle" type="button" aria-expanded="false" aria-controls="language-options" aria-label="${english ? 'Choose language' : '언어 선택'}">LANG</button><div class="language-options" id="language-options" hidden><a class="language-option${english ? '' : ' selected'}" href="${kr}" lang="ko" hreflang="ko" data-language="ko" aria-label="한국어"${english ? '' : ' aria-current="true"'}><span aria-hidden="true">🇰🇷</span> KR</a><a class="language-option${english ? ' selected' : ''}" href="${en}" lang="en" hreflang="en" data-language="en" aria-label="English"${english ? ' aria-current="true"' : ''}><span aria-hidden="true">🇺🇸</span> EN</a></div></div>`;
}
for (const file of pages) {
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const dom=new JSDOM(source);const d=dom.window.document;
 d.documentElement.lang='en';
 d.querySelectorAll('script[src$="language.js"],link[rel="alternate"]').forEach(e=>e.remove());
 // Switch pages rather than replacing partial text at runtime.
 d.querySelectorAll('.language-switch,.language-picker').forEach(e=>e.remove());
 d.querySelector('.nav-links').insertAdjacentHTML('beforeend',languagePicker(file,true));
 d.querySelectorAll('[aria-label]').forEach(e=>{if(!e.closest('.language-picker') && /[가-힣]/.test(e.getAttribute('aria-label')))e.setAttribute('aria-label',e.classList.contains('burger')?'Open menu':'Learn more about this research area');});
 set(d,'.skip-link','Skip to content');
 if(file==='index.html') {
  set(d,'.home-hero h1','People and AI,<br><em>further together.</em>',true);
  set(d,'.hero-credentials strong','AI / NLP Researcher');
  set(d,'.hero-affiliation','Assistant Professor · Division of English, Sogang University');
  set(d,'.home-hero .lead','We study how people can think and work with AI as a collaborative partner—advancing productivity and human capabilities through knowledge, creativity, culture, and learning.');
  set(d,'.research-home .sec-head p','Four research directions advancing Human–AI Collaboration.');
  for(const [area,r] of Object.entries(research)) {set(d,'.research-card.area-'+area+' .area-subtitle',r.subtitle);set(d,'.research-card.area-'+area+' .area-description',r.overview);set(d,'.research-card.area-'+area+' .area-more','Learn more ↗');}
  set(d,'#awards .sec-head p','Recent recognition for our research and projects.');
  set(d,'.join p','We are not currently accepting additional research interns or graduate students. Any future openings will be announced on this website.');
 }
 if(file==='research.html') {
  set(d,'.page-head p','Our research centers on Human–AI Collaboration: helping people make better decisions, create, and learn with AI.');
  for(const [area,r] of Object.entries(research)){set(d,'#'+area+' .eyebrow',r.eyebrow);set(d,'#'+area+' .research-question',r.question);set(d,'#'+area+' .research-copy > p',r.body);set(d,'#'+area+' .focus-note','<h3>Current focus</h3>'+r.focus.map(t=>'<p>'+t+'</p>').join(''),true);}
 }
 if(file==='members.html') {
  const paras=d.querySelectorAll('#about p');
  paras[0].textContent='I am an AI researcher and engineer with a foundation in natural language processing and multimodal learning, and experience spanning academia and industry. During my master’s and doctoral studies, I investigated AI models that understand language and information across modalities. At Carnegie Mellon University, I extended this work to AI frameworks for creative storytelling. I subsequently researched multimodal learning algorithms as an intern at LG AI Research and contributed to the development of the Mi:dm 2.0 large language model at KT.';
  paras[1].textContent='As an Assistant Professor in the Division of English, College of Humanities, at Sogang University, I bring this engineering expertise to the human-centered study of Human–AI Collaboration. As AI becomes embedded across society and industry, I explore how people can work with it as a collaborative partner to strengthen creativity, productivity, and learning.';
  paras[2].textContent='My research and teaching connect the humanities and engineering. I bring insights into language, culture, creativity, and learning to the design and evaluation of AI, while educating students who combine humanistic insight with engineering approaches to problem solving.';
  for(const [ko,en] of [['조소영 (Soyoung Cho)',names.cho],['이서우 (Seowoo Lee)',names.lee],['남고은 (Goeun Nam)',names.nam],['김현재 (Hyunjae Kim)',names.kim]]){for(const e of d.querySelectorAll('.member h3'))if(e.textContent===ko)e.textContent=en;}
 }
 if(file==='news.html') set(d,'.page-head p','Updates on publications, projects, teaching, and our lab community.');
 if(file==='awards.html') set(d,'.page-head p','Recognition for research and projects by members of HAICoLab.');
 if(file==='contact.html') {
  set(d,'.page-head p','We welcome inquiries about research collaboration and teaching.');
  set(d,'.prose','Please email us about research collaboration or teaching. Office hours are available by appointment via email.');
  set(d,'.recruitment-note','<strong>Recruitment update</strong> · We are not currently accepting additional research interns or graduate students. Any future openings will be announced on this website.',true);
  for(const li of d.querySelectorAll('.kv li'))if(li.firstElementChild.textContent==='Phone')li.lastElementChild.textContent='+82-2-705-8295';
 }
 if(file==='projects.html') {
  const projects=[...d.querySelectorAll('.project')];
  const texts=[
   ['Integrated Framework for Automated Broadcast and Media Metadata Construction and Knowledge Structuring from Public Web Information','Electronics and Telecommunications Research Institute (ETRI) · Sogang University Industry–University Cooperation Foundation'],
   ['Scalable Remote Counseling Dialogues with Multimodal Chatbot Agents','Sogang University · Early-Career Researcher Support Program'],
   ['Interface Design for Seamless Human–Machine Communication','National Research Foundation of Korea (NRF) · BK21 FOUR'],
   ['AI-Led Global Innovation Talent Development Program','Supported by the Ministry of Science and ICT · Administered by IITP']
  ];
  projects.forEach((p,i)=>{p.querySelector('h3').textContent=texts[i][0];p.querySelector('.funder').textContent=texts[i][1];});
  projects[0].querySelector('p').textContent='An integrated framework that automates metadata construction for broadcast and media content from public web information and structures it into reusable knowledge resources. Principal investigator: '+names.heo+'.';
  projects[1].querySelector('p').textContent='Research on scalable remote psychological counseling dialogues using multimodal chatbot agents. Principal investigator: '+names.heo+'.';
  projects[2].querySelector('.period').textContent='Participation: October 2025 – February 2027';
  projects[3].querySelector('.period').textContent='Participation: September 2025 – Present';
  projects[2].querySelector('p').textContent=names.heo+' · Co-researcher · BK21 FOUR';
  projects[3].querySelector('p').textContent=names.heo+' · Co-researcher · Ongoing participation';
  projects[3].querySelectorAll('.funder')[1].textContent='Lead institution: Sogang University';
 }
 if(file==='teaching.html') {
  for(const e of d.querySelectorAll('.course h3')){const english=e.querySelector('small').textContent;e.textContent=english;}
  const c=d.querySelector('#sts2026');
  c.querySelector('.meta .term:last-child').textContent='3 credits · Open to all undergraduates';
  c.querySelector('p').textContent='Designed for students without an AI background, this course introduces generative AI and other AI methods through intuitive examples. Students use tools such as ChatGPT, Gemini, and Claude, along with public AI-Hub datasets, to create value in their own fields through team projects—including business plans, research proposals, videos, and images. The emphasis is on understanding and application rather than implementing algorithms.';
  c.querySelector('dl').innerHTML='<dt>Format</dt><dd>Lecture 70% · Discussion 10% · Presentations 20%</dd><dt>Evaluation</dt><dd>Two midterm exams 60% · Discussion and presentations 10% · Team project 25% · Participation 5%</dd>';
  c.querySelector('summary').textContent='Weekly topics (tentative)';
  const topics=['Course orientation and an introduction to the history of AI (online lecture)','Generative AI applications and prompt engineering (weeks 2–3)','Machine learning fundamentals for developing generative AI','Neural models for language: word embeddings and the evolution from RNNs to Transformers (weeks 6–7)','Midterm exam 1','Information retrieval and generative question answering','Computer vision and multimodal AI','Future directions: actionable AI and agents','AI innovation in science, medicine, biology, law, manufacturing, and the arts · Midterm exam 2','Critical evaluation and ethical use of AI outputs','Final presentations of generative AI projects (weeks 14–16)'];
  c.querySelector('ol').innerHTML=topics.map(t=>'<li>'+t+'</li>').join('');c.querySelector('.btn').textContent='Syllabus (PDF)';
  d.querySelector('#eng3510 a[href="courses/eng3510/2026-fall/"]').textContent='Course Website (Korean)';
  c.querySelector('a[href^="courses/"]').textContent='Project Team Building (Korean)';
  d.querySelector('#eng3510 a[href$="team-building/"]').textContent='Project Team Building (Korean)';
  d.querySelector('#eng2112 a[href$="team-building/"]').textContent='Project Team Building (English)';
 }
 d.querySelectorAll('.news li').forEach(li=>{const key=li.querySelector('.date').textContent.trim()+'|'+li.querySelector('.kind').textContent.trim();if(news[key])li.querySelector('.txt').innerHTML=news[key];});
 // Shared assets stay in the parent directory; links among English pages stay local.
 for(const e of d.querySelectorAll('[href],[src]'))for(const attr of ['href','src']){const v=e.getAttribute(attr);if(v&&/^(assets|css|js|courses)\//.test(v))e.setAttribute(attr,'../'+v);}
 for(const img of d.querySelectorAll('img'))if(/[가-힣]/.test(img.alt))img.alt='Yoonseok Heo (허윤석), Ph.D. in Computer Science and Engineering';
 const meta=d.querySelector('meta[name="description"]');if(meta)meta.content=({ 'index.html':'HAICoLab at Sogang University studies Human–AI Collaboration across knowledge, creativity, culture, and learning.', 'research.html':'Four research directions in Human–AI Collaboration at HAICoLab.', 'members.html':'Meet the faculty and students at HAICoLab, Sogang University.', 'news.html':'News from HAICoLab.', 'awards.html':'Research and project awards received by HAICoLab members.', 'contact.html':'HAICoLab contact information and recruitment updates.' })[file]||'HAICoLab — Human–AI Collaboration Lab at Sogang University.';
 d.title=d.title.replace(/허윤석/g,'Yoonseok Heo');
 const mainScript=d.querySelector('script[src="../js/main.js"]');
 const localized=d.createElement('script');localized.src='js/data-en.js';mainScript.before(localized);
 const langScript=d.createElement('script');langScript.src='../js/language.js';d.body.append(langScript);
 const alternate=d.createElement('link');alternate.rel='alternate';alternate.hreflang='ko';alternate.href='../'+file;d.head.append(alternate);
 fs.writeFileSync(path.join(root,'en',file),dom.serialize());
 // Preserve the current text on the Korean side, adding only the language switch.
 const ko=new JSDOM(source),kd=ko.window.document;
 kd.querySelectorAll('.language-switch,.language-picker').forEach(e=>e.remove());
 kd.querySelector('.nav-links').insertAdjacentHTML('beforeend',languagePicker(file,false));
 if(!kd.querySelector('script[src="js/language.js"]')){const s=kd.createElement('script');s.src='js/language.js';kd.body.append(s);}
 if(!kd.querySelector('link[hreflang="en"]')){const l=kd.createElement('link');l.rel='alternate';l.hreflang='en';l.href='en/'+file;kd.head.append(l);}
 fs.writeFileSync(path.join(root,file),ko.serialize());
}
console.log('Built '+pages.length+' English pages and Korean language switches.');
