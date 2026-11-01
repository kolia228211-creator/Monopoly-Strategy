"""PDF-звіт self-play українською.
python3 tools/selfplay/report.py  ->  tools/selfplay/out/selfplay-report.pdf
Бере out/best-dbl{1,0}.json, out/questions-dbl{1,0}.json і out/findings.json (висновки, написані після аналізу)."""
import json, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from reportlab.lib.styles import ParagraphStyle

D = os.path.join(os.path.dirname(__file__), 'out')
F = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('DV', F + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', F + 'DejaVuSans-Bold.ttf'))
plt.rcParams['font.family'] = 'DejaVu Sans'

H1 = ParagraphStyle('h1', fontName='DVB', fontSize=20, leading=24, spaceAfter=8, textColor=colors.HexColor('#2a2160'))
H2 = ParagraphStyle('h2', fontName='DVB', fontSize=14, leading=18, spaceBefore=10, spaceAfter=6, textColor=colors.HexColor('#3d2f8f'))
P = ParagraphStyle('p', fontName='DV', fontSize=10, leading=14, spaceAfter=4)
S = ParagraphStyle('s', fontName='DV', fontSize=8.5, leading=11, textColor=colors.HexColor('#555555'))
B = ParagraphStyle('b', parent=P, leftIndent=12, bulletIndent=2)

def load(n):
    p = os.path.join(D, n)
    return json.load(open(p)) if os.path.exists(p) else None

runs = {k: load(f'best-dbl{k}.json') for k in (1, 0)}
qs = {k: load(f'questions-dbl{k}.json') for k in (1, 0)}
fd = load('findings.json') or {'rules': [], 'notes': []}
pct = lambda x: f'{100 * x:.1f}%'

def tstyle():
    return TableStyle([('FONT', (0, 0), (-1, -1), 'DV', 9), ('FONT', (0, 0), (-1, 0), 'DVB', 9),
                       ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#ece7fa')), ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#c9c2e6')),
                       ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f7f5fd')])])

story = [Paragraph('Self-play: стратегії для richup.io', H1),
         Paragraph('Боти зіграли між собою понад мільйон партій за точними правилами richup (мапа Classic, $1500, аукціони, vacation cash, застава, рівномірна забудова, колоди по колу). Еволюційний пошук підбирав параметри стратегії; знайдене вбудовано в помічника.', P)]

# Було -> стало
rows = [['', 'x2 оренда ON', 'x2 оренда OFF']]
def cell(k, path):
    r = runs[k]
    if not r: return '—'
    v = r['validation'][path]
    return f"{pct(v['default']['norm'])} → {pct(v['best']['norm'])}"
rows.append(['Проти суміші (поточні + людиноподібні)', cell(1, 'mixed'), cell(0, 'mixed')])
rows.append(['Проти лише людиноподібних', cell(1, 'vsHumans'), cell(0, 'vsHumans')])
rows.append(['Зіграно партій', *(f"{runs[k]['totalGames']:,}".replace(',', ' ') if runs[k] else '—' for k in (1, 0))])
story += [Paragraph('Було → стало (частка перемог, нормована на стіл з 4; рівний шанс = 25%)', H2), Table(rows, colWidths=[78 * mm, 45 * mm, 45 * mm], style=tstyle())]

if fd.get('rules'):
    story += [Paragraph('Правила-відкриття для гри з друзями', H2)]
    for r in fd['rules']:
        story.append(Paragraph(r, B, bulletText='•'))

# Графік еволюції
fig, ax = plt.subplots(figsize=(7, 2.8))
for k, c in ((1, '#5b47d6'), (0, '#e0803a')):
    if runs[k]:
        g = [x['gen'] for x in runs[k]['log']]; b = [100 * x['best'] for x in runs[k]['log']]; m = [100 * x['meanCand'] for x in runs[k]['log']]
        ax.plot(g, m, color=c, lw=2, label=f"x2 {'ON' if k else 'OFF'}: середнє поколінь")
        ax.plot(g, b, color=c, lw=0.8, alpha=0.5, ls='--', label=f"x2 {'ON' if k else 'OFF'}: найкращий кандидат")
ax.axhline(25, color='#999', lw=0.8, ls=':'); ax.text(0, 25.5, 'рівний шанс 25%', fontsize=7, color='#777')
ax.set_xlabel('покоління'); ax.set_ylabel('перемоги, %'); ax.grid(alpha=0.25); ax.legend(fontsize=7, ncol=2)
fig.tight_layout(); fig.savefig(os.path.join(D, 'evo.png'), dpi=170); plt.close(fig)
story += [Paragraph('Еволюція фітнесу', H2), Image(os.path.join(D, 'evo.png'), width=160 * mm, height=58 * mm),
          Paragraph('Фітнес шумний (кожне покоління грає на нових seed, суперники частково випадкові), тому лінії скачуть; важлива тенденція й фінальна валідація на окремих seed.', S)]

story.append(PageBreak())
for k in (1, 0):
    q = qs[k]
    if not q: continue
    story.append(Paragraph(f"Відкриті питання (x2 оренда {'ON' if k else 'OFF'}), {q['games']} партій на варіант", H2))
    rows = [['Варіант', 'Перемоги', '±95%']] + [[v['name'], pct(v['norm']), pct(v['ci'])] for v in q['variants']]
    story.append(Table(rows, colWidths=[100 * mm, 30 * mm, 25 * mm], style=tstyle()))
    rows = [['Перший зібраний набір', 'Перемагаєш', 'Партій']] + [[s['name'], pct(s['winRate']), str(s['had'])] for s in q['sets']]
    story += [Spacer(1, 6), Table(rows, colWidths=[60 * mm, 30 * mm, 25 * mm], style=tstyle()), Spacer(1, 8)]

story.append(PageBreak())
story.append(Paragraph('Знайдені параметри', H2))
names = {'stageEarly': 'Множник цінності, рання гра', 'stageLate': 'Множник цінності, пізня гра', 'H': 'Горизонт окупності (ходів суперника)',
         'complete': 'Бонус за завершення набору (частка T)', 'step': 'Бонус за крок до набору', 'block': 'Бонус за блокування суперника',
         'air': 'Вага аеропортів/компаній', 'buyMin': 'Купувати, якщо цінність ≥ ціна ×', 'resBase': 'Запас при купівлі, база $', 'resLate': 'Запас при купівлі, пізня гра +$',
         'aucMult': 'Аукціон: максимум = цінність ×', 'aucKeep': 'Аукціон: лишати $', 'bRes': 'Запас при будівництві $', 'bResGrow': 'Запас росте на $/коло',
         'maxLevel': 'Будувати до рівня (5 = готель)', 'unmortCash': 'Викупати заставу, якщо грошей >', 'jailU': 'Виходити з тюрми, поки вільних ділянок >',
         'trade': 'Активність обмінів', 'buyShare': 'Доплата за останню ділянку (частка T)', 'swapPay': 'Доплата в обміні 1↔1 (множник)',
         'deny': 'Ціна загрози, коли продаєш ключову ділянку', 'acceptMargin': 'Приймати обмін, якщо вигода > $', 'buildCashLots': 'Лишати на будинки (будинків на ділянку)'}
rows = [['Параметр', 'Було', 'x2 ON', 'x2 OFF']]
base = (runs[1] or runs[0])['default']
fmt = lambda v: f'{v:.2f}' if isinstance(v, float) and abs(v) < 10 else f'{v:.0f}'
for k in names:
    rows.append([names[k], fmt(base[k]), fmt(runs[1]['params'][k]) if runs[1] else '—', fmt(runs[0]['params'][k]) if runs[0] else '—'])
story.append(Table(rows, colWidths=[85 * mm, 22 * mm, 22 * mm, 22 * mm], style=tstyle()))
story += [Paragraph('Обмеження', H2)] + [Paragraph(n, B, bulletText='•') for n in fd.get('notes', [])]

doc = SimpleDocTemplate(os.path.join(D, 'selfplay-report.pdf'), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                        title='Self-play: стратегії richup', author='Claude')
doc.build(story)
print('ok', os.path.join(D, 'selfplay-report.pdf'))
