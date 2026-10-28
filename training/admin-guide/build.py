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

TITLES=['Настройте город и год','Вставьте информацию о рассрочке','Проверьте данные','Проверьте договор справа','Скачайте договор']
PAGES=len(TITLES)
def header(step,lead=None):
    c.bookmarkPage('step'+str(step));c.addOutlineEntry('Шаг '+str(step)+'. '+TITLES[step],'step'+str(step),0)
    c.drawImage(str(HERE/'logo.png'),M,H-49,width=112,height=112*176/670,mask='auto')
    text('ПАМЯТКА АДМИНИСТРАТОРУ',W-269,30,227,9,'Bold',MUTED)
    text('ШАГ '+str(step),M,73,CW,11,'Bold',PURPLE)
    text(TITLES[step],M,96,CW,23,'Bold',INK,29)
    if lead:text(lead,M,140,CW,12,leading=17)

def footer(step):
    line(M,800,W-M,800,LINE,.8)
    text('Договор рассрочки · '+str(step+1)+' / '+str(PAGES),M,811,270,9,color=MUTED)
    if step<PAGES-1:
        text('Дальше →',W-175,808,133,10.5,'Bold',GREEN)
        c.linkRect('','step'+str(step+1),(W-180,H-828,W-M,H-804),relative=0,thickness=0)
    c.showPage()

def overview(step,top=192,caption=None):
    im=image('overview-'+str(step),(W-470)/2,top,470)
    r=META[im['name']]['targets']['focus'];x=im['x']+r['x']*im['scale'];y=im['top']+r['y']*im['scale']
    w=r['width']*im['scale'];h=r['height']*im['scale']
    c.setStrokeColor(HexColor(PURPLE));c.setLineWidth(1.7);c.roundRect(x-1,H-y-h-1,w+2,h+2,3,fill=0,stroke=1)
    if step==4:
        text('Кнопка — вверху справа',305,166,248,11,'Bold',PURPLE)
        arrow([(x+w/2,184),(x+w/2,y-2)])
    else:
        target=(x+w/2,y+h-2)
        # Keep the connector outside the caption, whichever side the area is on.
        label_width=pdfmetrics.stringWidth(caption,'Bold',11)
        label_x=M if M+label_width+20<target[0] else target[0]+18
        text(caption,label_x,top+im['h']+11,W-M-label_x,11,'Bold',PURPLE)
        connector_x=label_x+label_width+8 if label_x<target[0] else label_x-8
        start_y=top+im['h']+19
        arrow([(connector_x,start_y),(target[0],start_y),target])
    return im

# Step 0: original empty Sochi state, then a close-up after saving a new office.
header(0)
box(M,141,CW,65,'#EDF6F0','#EDF6F0')
text('<b>Настроить надо только один раз — город и год сохранятся.</b><br/>Если понадобится поменять их снова — повторите шаг 0.',M+14,151,CW-28,11.5,color=GREEN,leading=17)
overview(0,224,'Настройки — внизу левого окна')
im=image('settings',293,580,260)
for number,key,title,body in [(1,'city','Укажите свой город','Например, Москва.'),(2,'year','Укажите нужный год','Год договора.'),(3,'save','Нажмите «Сохранить»','Появилось «Сохранено» — готово.')]:
    target=point(im,key,'left');top=target[1]-20;badge(number,M,top+1)
    text(title,M+33,top,204,11.5,'Bold',PURPLE)
    text(body,M+33,top+19,204,10,color=MUTED,leading=13)
    arrow([(279,target[1]),target])
footer(0)

# Step 1: message already pasted, but recognition has not run yet.
header(1,'Вставьте сообщение специалиста в левое окно<br/>и нажмите «Распознать».')
overview(1,192,'Информация о рассрочке — здесь')
image('source',M,539,319)
text('Файл сам разберёт<br/>обычное сообщение.<br/><br/><b>Подарки в договор<br/>не попадут.</b>',390,548,163,12,leading=17)
image('recognize',390,662,163)
arrow([(472,652),(472,667)])
text('Нажмите «Распознать».',385,713,168,10.5,'Bold',GREEN)
box(M,756,CW,32,'#EDF6F0','#EDF6F0')
text('Нет текста? Заполните второе окно вручную.',M+14,764,CW-28,11.5,color=GREEN)
footer(1)

# Step 2: the next complete overview visibly contains the recognition results.
header(2,'После «Распознать» данные появились во втором окне.<br/>Любое поле можно исправить или заполнить вручную.')
overview(2,192,'Заполненные поля — здесь')
image('purchase',M,539,230)
text('<b>Если взнос и срок не указаны:</b><br/>50% — первый взнос,<br/>остаток — на 3 месяца.',292,539,261,11.5,leading=16)
text('Измените взнос или срок —<br/>платежи пересчитаются сами.',292,604,261,11.5,leading=16)
box(285,648,268,117,'#F5F7F5',LINE)
text('<b>Если сумма делится с копейками:</b><br/>37 000 ÷ 3 = 12 333,33 ₽.<br/><b>12 300 + 12 300 + 12 400 = 37 000 ₽.</b><br/>Первые платежи округляются до сотен.<br/>Последний выравнивает остаток.',297,658,244,10.5,leading=17)
text('Проверьте сумму<br/>и график платежей.',292,771,261,10.5,'Bold',PURPLE,leading=12)
footer(2)

# Step 3: manual identity data and contract date are now filled in too.
header(3,'Справа уже заполнены договор и график платежей.<br/>Если нужна правка — нажмите на нужный текст.')
overview(3,192,'Готовый договор — справа')
image('document',M,539,CW)
im=image('calendar',M,646,286)
target=point(im,'amount','right');arrow([(339,635),(339,target[1]),target])
text('<b>График считается сам.</b><br/>Первый платёж — через месяц,<br/>дальше — каждый месяц.<br/>Можно ничего не менять.<br/><br/>Если нужно — нажмите<br/>на дату или сумму.',350,644,203,10.5,leading=14)
box(M,755,CW,34,'#FFF7E6','#FFF7E6')
text('<b>Перед печатью проверьте все данные:</b><br/>ФИО, аппараты, реквизиты, суммы и даты.',M+12,760,CW-24,10.5,color='#725715',leading=13)
footer(3)

# Step 4: one button and the browser's default download folder, no printing tutorial.
header(4,'Нажмите «Скачать и распечатать» — скачается договор Word.')
overview(4,192)
image('download',101,541,393)
text('Файл сохранится в папке, выбранной для загрузок<br/>в браузере. Обычно это <b>«Загрузки»</b>.',M,675,CW,13,leading=19)
text('Откройте скачанный Word и распечатайте.',M,728,CW,12)
box(M,760,CW,29,'#EDF6F0','#EDF6F0')
text('<b>Данные клиента после закрытия HTML не сохраняются.</b>',M+12,767,CW-24,10.5,color=GREEN)
footer(4)
c.save()
print('Built',dest)
