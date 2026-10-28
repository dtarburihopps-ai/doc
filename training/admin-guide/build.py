"""Build the current illustrated staff guide from application screenshots."""
from pathlib import Path
from zipfile import ZipFile
import json,math
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
META=json.loads((HERE/'screens.json').read_text())
for name,file in [('Body','DejaVuSans.ttf'),('Bold','DejaVuSans-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'/usr/share/fonts/truetype/dejavu/'+file))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Body',boldItalic='Bold')
W,H=A4;M=42;CW=W-2*M
INK='#23322F';MUTED='#63736C';GREEN='#23634E';PURPLE='#713182';LINE='#DCE5DF'
dest=ROOT/'dist/staff-guide.pdf'
with ZipFile(ROOT/'assets/contract-layout.docx')as z:(HERE/'logo.png').write_bytes(z.read('word/media/image2.png'))
c=canvas.Canvas(str(dest),pagesize=A4,pageCompression=1)
c.setTitle('Как заполнить и распечатать договор рассрочки')
c.setAuthor('СлышуВижу')
c.setSubject('Пошаговая инструкция администраторам: актуальная версия с кнопкой «Скачать и распечатать»')

def box(x,top,w,h,fill='#FFFFFF',stroke=LINE,r=11):
    c.setFillColor(HexColor(fill));c.setStrokeColor(HexColor(stroke));c.setLineWidth(.8)
    c.roundRect(x,H-top-h,w,h,r,fill=1,stroke=1)

def text(value,x,top,w,size=12,font='Body',color=INK,leading=None):
    p=Paragraph(value,ParagraphStyle('p',fontName=font,fontSize=size,leading=leading or size*1.42,textColor=HexColor(color),spaceBefore=0,spaceAfter=0))
    _,height=p.wrap(w,1000);p.drawOn(c,x,H-top-height);return height

def line(x1,y1,x2,y2,color=PURPLE,width=1.7):
    c.setStrokeColor(HexColor(color));c.setLineWidth(width);c.line(x1,H-y1,x2,H-y2)

def arrow(points,color=PURPLE):
    c.setLineCap(1);c.setLineJoin(1)
    for a,b in zip(points,points[1:]):line(*a,*b,color=color)
    a,b=points[-2:];angle=math.atan2(b[1]-a[1],b[0]-a[0]);length=7
    for d in [-.5,.5]:line(b[0],b[1],b[0]-length*math.cos(angle+d),b[1]-length*math.sin(angle+d),color=color)

def image(name,x,top,w,max_h=None):
    data=META[name];h=w*data['height']/data['width']
    if max_h and h>max_h:w*=max_h/h;h=max_h
    box(x-3,top-3,w+6,h+6,r=6)
    c.drawImage(str(HERE/data['file']),x,H-top-h,width=w,height=h,mask='auto')
    return {'name':name,'x':x,'top':top,'w':w,'h':h,'scale':w/data['width']}

def point(im,key,side='center'):
    t=META[im['name']]['targets'][key];x=t['x']+t['width']/2;y=t['y']+t['height']/2
    if side=='left':x=t['x']-3
    if side=='right':x=t['x']+t['width']+3
    if side=='top':y=t['y']-3
    x=max(5,min(META[im['name']]['width']-5,x));y=max(5,min(META[im['name']]['height']-5,y))
    return(im['x']+x*im['scale'],im['top']+y*im['scale'])

def badge(number,x,top):
    c.setFillColor(HexColor(PURPLE));c.circle(x+12,H-top-12,12,fill=1,stroke=0)
    c.setFillColor(HexColor('#FFFFFF'));c.setFont('Bold',12)
    c.drawCentredString(x+12,H-top-16,str(number))

def note(title,body,top,h=70,color=GREEN,fill='#EDF6F0',x=M,w=CW):
    box(x,top,w,h,fill,fill);text(title,x+16,top+11,w-32,13,'Bold',color)
    if body:text(body,x+16,top+33,w-32,11.5,color=color)

def where(top,active):
    labels=['1. Исходный текст','2. Данные договора','3. Договор и акт'];gap=7;width=(CW-2*gap)/3
    for i,label in enumerate(labels):
        x=M+i*(width+gap);box(x,top,width,29,'#EAF3EE'if i==active else'#F6F8F6',GREEN if i==active else LINE,r=7)
        text(label,x+8,top+7,width-16,10.5,'Bold'if i==active else'Body',GREEN if i==active else MUTED)

TITLES=['Настройте город и год','Вставьте текст клиента','Дополните пустые поля','Проверьте договор справа','Скачайте и распечатайте','Следующий клиент']
def header(step,lead):
    c.bookmarkPage('step'+str(step));c.addOutlineEntry('Шаг '+str(step)+'. '+TITLES[step],'step'+str(step),0)
    c.drawImage(str(HERE/'logo.png'),M,H-49,width=112,height=112*176/670,mask='auto')
    text('ПАМЯТКА АДМИНИСТРАТОРУ',W-269,30,227,9,'Bold',MUTED)
    tag='ШАГ 0 · ОДИН РАЗ'if step==0 else'ШАГ '+str(step)
    text(tag,M,76,CW,11,'Bold',PURPLE)
    text(TITLES[step],M,101,CW,25,'Bold',INK,31)
    text(lead,M,145,CW,13,leading=19)

def footer(step):
    line(M,800,W-M,800,LINE,.8)
    text('Договор рассрочки · '+str(step+1)+' / 6',M,811,270,9,color=MUTED)
    label='Дальше →'if step<5 else'К заполнению →';target='step'+str(step+1)if step<5 else'step1'
    text(label,W-175,808,133,10.5,'Bold',GREEN);c.linkRect('',target,(W-180,H-828,W-M,H-804),relative=0,thickness=0)
    c.showPage()

# 0: opening and settings, with the one-time nature stated before any screenshot.
header(0,'Настройте <b>один раз</b> перед первым договором.<br/>Потом — только если нужно изменить город или год.')
box(M,197,CW,62,'#F5F7F5',LINE)
text('Получили ZIP? Сначала распакуйте архив.<br/>Откройте <b>«Договор рассрочки.html»</b> двойным щелчком в Chrome или Edge.',M+14,208,CW-28,11.5)
where(275,0)
text('Внизу левого окна раскройте «Настройки».',M,320,CW,12)
im=image('settings',246,350,307)
for number,key,title,body in [(1,'city','Ваш город','Например, Москва.'),(2,'year','Нужный год','Год договора.'),(3,'save','«Сохранить»','Нажмите эту кнопку.')]:
    target=point(im,key,'left');top=target[1]-26;box(M,top,180,51,'#FFFFFF','#E3D4EA',r=8);badge(number,M+9,top+12)
    text(title,M+42,top+7,128,12,'Bold',PURPLE);text(body,M+42,top+27,128,10.5,color=MUTED)
    arrow([(M+180,target[1]),(target[0]-8,target[1]),target])
note('Появилось «Сохранено» — готово.', 'Открывайте этот же HTML в том же браузере.',665,63)
text('«Сохранить» запоминает город и год.<br/>Сам договор скачиваем отдельно — на шаге 4.',M,744,CW,11.5,color=MUTED)
footer(0)

# 1: two real close-ups, rather than a tiny screenshot of the whole application.
header(1,'Скопируйте сообщение клиента и вставьте его в левое окно.')
where(192,0)
text('1. Вставьте весь текст',M,242,CW,14,'Bold')
im=image('source',M,275,340)
box(402,292,151,122,'#F5F7F5',LINE)
text('Скопировать<br/><b>Ctrl + C</b><br/><br/>Вставить<br/><b>Ctrl + V</b>',416,305,123,12)
arrow([(402,350),(389,350),(im['x']+im['w']-8,im['top']+80*im['scale'])])
text('На скриншотах — вымышленные данные.',M,548,CW,9.5,color=MUTED)
text('2. Нажмите «Распознать»',M,581,CW,14,'Bold')
im=image('recognize',M,614,340)
text('Данные появятся<br/>в средней колонке.<br/><br/><b>Дальше —<br/>проверка.</b>',404,625,147,12,color=GREEN)
box(M,757,CW,32,'#EDF6F0','#EDF6F0')
text('Нет сообщения? <b>Заполните поля сами на шаге 2.</b>',M+14,764,CW-28,11.5,color=GREEN)
footer(1)

# 2: enough of the form to explain manual input, not an instruction per field.
header(2,'Средняя колонка — все данные договора.<br/>Любое поле можно заполнить или исправить.')
where(205,1)
im=image('fields',258,267,285)
box(M,281,187,159,'#F4F8F5',LINE)
text('Пустое поле?<br/><b>Впишите данные сами.</b><br/><br/>Можно заполнить всю форму вручную, даже без текста слева.',M+14,296,159,12.5)
target=point(im,'address','left');arrow([(229,370),(243,370),(243,target[1]),target])
text('Изменили поле →<br/>договор справа<br/>обновился.',M,470,185,13,'Bold',GREEN)
text('Дату тоже можно выбрать',M,568,CW,14,'Bold')
image('date',M,603,CW)
text('Введите дату вручную, выберите календарь<br/>или нажмите «Сегодня».',M,720,CW,12)
footer(2)

# 3: large close-ups of editable content and the payment calendar.
header(3,'Нажмите на текст, если нужно что-то исправить.<br/>Двойной щелчок выделяет значение для замены.')
where(205,2)
text('Сверьте ФИО и наименование товара',M,252,CW,13,'Bold')
image('document',M,287,CW)
box(M,389,CW,43,'#F3EEF6','#F3EEF6')
text('Можно исправлять и поля в средней колонке,<br/>и сам текст договора справа.',M+14,397,CW-28,11.5,color=PURPLE)
text('Проверьте даты и суммы платежей',M,459,CW,13,'Bold')
im=image('calendar',M,499,CW)
target=point(im,'amount','right');arrow([(W-M+8,485),(W-M+8,target[1]),target])
text('Нажмите на сумму,<br/>если нужна правка.',340,452,213,10.5,color=PURPLE)
box(M,685,CW,98,'#F4F8F5',LINE)
text('<b>Перед скачиванием проверьте:</b><br/>• ФИО и реквизиты покупателя;<br/>• аппараты, стоимость и взнос;<br/>• дату, срок и весь график платежей.',M+15,696,CW-30,12)
footer(3)

# 4: the actual current download control, followed by an explicit Word workflow.
header(4,'Сначала скачайте файл. Затем откройте его в Word и печатайте.')
text('1. Нажмите кнопку вверху справа',M,205,CW,14,'Bold')
im=image('download',M+32,247,320)
target=point(im,'download','right');arrow([(492,308),(492,target[1]),target])
text('Кнопка скачивает<br/>документ Word.',427,250,126,11.5,color=GREEN)
text('2. Найдите скачанный файл и откройте его',M,363,CW,14,'Bold')
box(M,401,CW,93,'#F4F8F5',LINE)
text('<b>Папка «Загрузки» → Заполненный_ФИО.docx</b><br/>Откройте этот файл в Word.<br/><font color="'+MUTED+'">Не нашли? В браузере нажмите Ctrl + J — откроются загрузки.</font>',M+15,416,CW-30,11.5)
text('3. В Word нажмите Ctrl + P',M,526,CW,14,'Bold')
box(M,565,148,61,'#FFFFFF','#D2DDEB')
text('Ctrl + P',M+20,579,108,22,'Bold','#285A8D')
arrow([(M+165,595),(M+198,595)],GREEN)
text('Выберите принтер<br/>и нажмите «Печать».',M+220,575,285,13)
note('Word спросил об обновлении полей?', 'Нажмите «Да» — это обновит номер страницы.',665,68,color='#725715',fill='#FFF7E6')
text('Перед закрытием HTML обязательно скачайте договор.',M,754,CW,11.5,color=MUTED)
footer(4)

# 5: reset for the next customer.
header(5,'Сначала скачайте готовый договор предыдущего клиента.')
where(191,0)
text('Нажмите «Очистить»',M,254,CW,14,'Bold')
im=image('clear',M+20,298,430)
target=point(im,'clear','top');arrow([(W-M,265),(W-M,285),(target[0],285),target])
box(M,405,CW,62,'#F5F7F5',LINE)
text('Если появится вопрос об очистке — подтвердите.<br/><b>Поля и исходный текст снова станут пустыми.</b>',M+15,418,CW-30,12)
text('Город и год останутся.',M,496,CW,16,'Bold',GREEN)
text('Теперь вставьте новое сообщение или заполните поля вручную.<br/>Вернитесь к шагу 1 →',M,530,CW,12.5)
c.linkRect('','step1',(M,H-571,W-M,H-529),relative=0,thickness=0)
text('Данные клиента после закрытия HTML не сохраняются.<br/>Сохраняйте нужный договор кнопкой «Скачать и распечатать».',M,590,CW,11.5,color=MUTED)
footer(5)
c.save()
print('Built',dest)
