const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path');
const root=path.resolve(__dirname,'..'),out='/tmp/contract-audit';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(root,'dist/Договор рассрочки.html')))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const p=await browser.newPage();await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForSelector('#preview [data-bind]');
 const result=await p.evaluate(()=>{
  let checks=0;const failures=[];const check=(name,ok,data)=>{checks++;if(!ok)failures.push({name,data})};
  const app=ContractApp,number=n=>String(n).replace(/\s/g,'');
  const samples=[
   ['Попов Владимир Геннадьевич\nПравое ухо: Terra BTE-SP\nСер.номер: 2609X3VHL\nЛевое ухо: Terra BTE-SP\nСер.номер: 2613X0K7Y\nИтого 37000 *2=74 000, Наша рассрочка на три месяца, сейчас 37 000 В подарок 1 блистер батареек и 2 стандартных вкладыша, и футляр',74000,37000,3,'Terra BTE-SP — 2 шт.'],
   ['Ложкина Н. Г.\nПравое ухо: Oticon Xceed 3 BTE SP - 75 000 руб.\nСер.номер:\nЛевое ухо: Oticon Xceed 3 BTE SP - 75 000 руб.\nВ подарок: стандартный вкладыш 2 + блистер 13 (1 шт)\nИтого: 150 000 руб. ( ПВ 75 000 руб. карта + ВР на 1 месяц)',150000,75000,1,'Oticon Xceed 3 BTE SP — 2 шт.'],
   ['Пупкина Лера Константиновна\nПравое ухо: Audeo L50-R\nСер.номер: 2616N21LT\nЛевое ухо: Audeo L50-R\nСер.номер: 2452X0P2P\n164-20%=131 200 *2 = 262 400, сейчас 142400 т остальное в нашу рассрочку 3 месяцев\nв подарок зарядка ЗУ Charger Ease (Lumity), ресивер М -2 шт, фильтры 1 шт, 2 вкладыша Фонак',262400,142400,3,'Audeo L50-R — 2 шт.'],
   ['Правое ухо: Opn S 3 BTE PP (105)\nСер.номер: 30932229\nитого 113 000, внутренняя сейчас 56 500 и на три месяца, в подарок блистер бат 13 и стандарт вклад',113000,56500,3,'Opn S 3 BTE PP (105) — 1 шт.'],
   ['Правое ухо: Xceed 3 BTE UP (120)\nСер.номер: 38314957\nЛевое ухо: Xceed 3 BTE UP (120)\nСер.номер: 38368723\nХитрова Вера Сергеевна\nИтого 160 000р в подарок 1 стандр вкл + бат 675- 2шт.\nОплата Сейчас 100 и наша рассрочка на три месяца остаток по 20 т в месяц',160000,100000,3,'Xceed 3 BTE UP (120) — 2 шт.']
  ];
  samples.forEach(([text,total,pv,months,product],i)=>{const r=app.parseText(text);check('sample '+(i+1),number(r.values.total)==total&&number(r.values.downPayment)==pv&&Number(r.values.months)===months&&r.values.product===product,r);if(i===3)check('missing name is not invented',!r.values.fullName,r)});
  for(const alias of ['ПВ','первоначальный взнос','первый взнос','оплата сейчас','сейчас','аванс','внесено']){
   const r=app.parseText('Итого 120 000, '+alias+' 70 000, рассрочка на 4 месяца');check('deposit alias '+alias,number(r.values.downPayment)==70000&&r.values.months==='4',r);
  }
  const words=['один','два','три','четыре','пять','шесть','семь','восемь','девять','десять','одиннадцать','двенадцать'];
  const terms=['одного календарного месяца','двух календарных месяцев','трех календарных месяцев','четырех календарных месяцев','пяти календарных месяцев','шести календарных месяцев','семи календарных месяцев','восьми календарных месяцев','девяти календарных месяцев','десяти календарных месяцев','одиннадцати календарных месяцев','двенадцати календарных месяцев'];
  for(let n=1;n<=12;n++){
   for(const token of [String(n),words[n-1]]){const r=app.parseText('Итого 120 000, рассрочка на '+token+' '+(n===1?'месяц':n<=4?'месяца':'месяцев'));check('term parse '+token,+r.values.months===n,r)}
   check('term grammar '+n,app.termText(n)===terms[n-1],app.termText(n));
  }
  const total=120000;
  for(const rest of [10,20,50,100,200,300,400,500,600,700,800,900,1000,1100,1500,5000,10000,37000,56500,120000]){
   for(let n=1;n<=12;n++){
    const rows=app.schedule(total,total-rest,n,new Date(2024,0,31,12));
    check('schedule count/sum '+rest+'/'+n,rows.length===n&&rows.reduce((s,r)=>s+r.amount,0)===rest,rows);
    check('schedule whole/nonnegative '+rest+'/'+n,rows.every(r=>Number.isInteger(r.amount)&&r.amount>=0),rows);
    if(rest>=n)check('schedule positive '+rest+'/'+n,rows.every(r=>r.amount>0),rows);
    if(rest>=n*100)check('ordinary payments rounded to hundreds '+rest+'/'+n,rows.slice(0,-1).every(r=>r.amount%100===0),rows);
    for(let i=0;i<n;i++){
     const monthIndex=1+i,y=2024+Math.floor(monthIndex/12),m=monthIndex%12,last=new Date(y,m+1,0).getDate();
     const expected=String(Math.min(31,last)).padStart(2,'0')+'.'+String(m+1).padStart(2,'0')+'.'+y;
     check('date '+rest+'/'+n+'/'+i,rows[i].date===expected,rows[i]);
    }
   }
  }
  for(const [start,expected]of [[new Date(2023,0,31,12),'28.02.2023'],[new Date(2024,0,31,12),'29.02.2024'],[new Date(2026,11,31,12),'31.01.2027']])check('calendar boundary '+expected,app.schedule(100000,50000,2,start)[0].date===expected);
  for(const months of [0,13,-1,1.5])check('invalid months '+months,app.schedule(100000,50000,months,null).length===0);
  const separate=app.parseText('Правое ухо: Model A\nЛевое ухо: Model B\nИтого 100000');check('distinct models',separate.values.product==='Model A — 1 шт., Model B — 1 шт.',separate);
  check('default deposit',number(separate.values.downPayment)==50000,separate);
  const none=app.parseText('В подарок: стандартный вкладыш\nИтого 100000');check('gift not a hearing aid',!none.values.product,none);
  const initials=app.parseText('Ложкина Н. Г.\nИтого 100000');check('initials not expanded',!initials.values.firstname&&!initials.values.patronymic&&initials.values.fullName==='Ложкина Н. Г.',initials);
  const heading=app.parseText('Оплата картой\nПопов Владимир Геннадьевич\nИтого 100000');check('payment heading is not a name',heading.values.fullName==='Попов Владимир Геннадьевич',heading);
  const joinedInitials=app.parseText('Ложкина Н.Г.\nИтого 100000');check('joined initials are not a first name',!joinedInitials.values.firstname&&!joinedInitials.values.patronymic&&joinedInitials.values.fullName==='Ложкина Н.Г.',joinedInitials);
  const shortName=app.parseText('ФИО: Попов Ян Иванович');check('short real first name is not an initial',shortName.values.firstname==='Ян',shortName);
  for(const [line,total]of [['Итого 120000 рассрочка на 3 месяца',120000],['Итого 120000 за 2 аппарата',120000],['Итого 74000 на 3 месяца сейчас 37000',74000],['Итого 37000 * 2 = 74000',74000],['Итого 164-20%=131200 * 2 = 262400',262400]]){const result=app.parseText(line);check('total amount without punctuation '+line,number(result.values.total)==total,result)}
  const identity=app.parseText('ФИО: Иванова Анна Сергеевна\nПаспорт: 4500 123456\nКем выдан: Учебный отдел 10.10.2020\nАдрес: Учебная улица, дом 10\nТелефон: +7 900 000-00-00\nДата договора: 31.01.2026');
  for(const key of ['fullName','surname','firstname','patronymic','passport','passportDate','passportIssuer','address','phone','contractDate'])check('parse identity '+key,!!identity.values[key],identity.values);
  return{checks,failures};
 });
 fs.writeFileSync(out+'/logic.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,failures:result.failures.length,examples:result.failures.slice(0,5)},null,2));if(result.failures.length)process.exitCode=1;
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
