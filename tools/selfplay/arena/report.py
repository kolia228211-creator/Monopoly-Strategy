"""PDF-звіт арени self-play (v0.5.1) українською.
python3 tools/selfplay/arena/report.py -> tools/selfplay/out/arena-report.pdf
Бере out/arena-*.json, out/robust-*.json, out/arena-validate.json, out/arena-exp.json, out/arena-findings.json."""
import json, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle

D = os.path.join(os.path.dirname(__file__), '..', 'out')
F = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('DV', F + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', F + 'DejaVuSans-Bold.ttf'))
plt.rcParams['font.family'] = 'DejaVu Sans'
INK = colors.HexColor('#1f2a44'); ACC = colors.HexColor('#2f6db5'); MUT = colors.HexColor('#5b6475')
H1 = ParagraphStyle('h1', fontName='DVB', fontSize=19, leading=24, spaceAfter=6, textColor=INK)
H2 = ParagraphStyle('h2', fontName='DVB', fontSize=13.5, leading=18, spaceBefore=10, spaceAfter=5, textColor=ACC)
P = ParagraphStyle('p', fontName='DV', fontSize=9.6, leading=13.6, spaceAfter=4, textColor=INK)
S = ParagraphStyle('s', fontName='DV', fontSize=8, leading=10.5, textColor=MUT)
B = ParagraphStyle('b', parent=P, leftIndent=12, bulletIndent=2)
TC = ParagraphStyle('tc', fontName='DV', fontSize=8, leading=10, textColor=INK)
TH = ParagraphStyle('th', fontName='DVB', fontSize=8, leading=10, textColor=colors.white)

def load(n):
    p = os.path.join(D, n)
    return json.load(open(p)) if os.path.exists(p) else None

def table(rows, widths, head=True, zebra=True):
    data = [[Paragraph(str(c), TH if (head and i == 0) else TC) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    st = [('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#c9cfdb')), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
          ('TOPPADDING', (0, 0), (-1, -1), 2.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5)]
    if head: st.append(('BACKGROUND', (0, 0), (-1, 0), ACC))
    if zebra:
        for i in range(1, len(rows)):
            if i % 2 == 0: st.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#f1f4f9')))
    t.setStyle(TableStyle(st)); return t

pct = lambda x: f'{100 * x:.1f}%'
val = load('arena-validate.json'); valA = load('arena-only-validate.json'); exp = load('arena-exp.json'); fnd = load('arena-findings.json') or {}
runs = {k: load(k + '.json') for k in ['arena-dbl0', 'arena-dbl1', 'robust-dbl0', 'robust-dbl1']}

# ---------- графіки ----------
def chart(name, keys, title):
    fig, axs = plt.subplots(1, 2, figsize=(9.6, 3.3), sharey=False)
    for ax, k in zip(axs, keys):
        j = runs.get(k)
        if not j: continue
        lg = [e for e in j['log'] if e['gen'] >= 0]
        g = [e['gen'] for e in lg]
        ax.plot(g, [e['best'] for e in lg], color='#9db7dd', lw=1, label='кращий кандидат покоління')
        ax.plot(g, [e['popMean'] for e in lg], color='#2f6db5', lw=1.6, label='середнє покоління')
        vv = [e for e in j['log'] if e.get('val') is not None]
        ax.errorbar([max(e['gen'], -1) for e in vv], [e['val'] for e in vv], yerr=[1.96 * e['valSe'] for e in vv], fmt='o-', color='#d0563b', ms=4, lw=1.4, capsize=2, label='контроль (окремі seed)')
        ax.axhline(1.0, color='#999', lw=0.8, ls=':')
        ax.set_title(('x2 OFF' if k.endswith('0') else 'x2 ON'), fontsize=10)
        ax.set_xlabel('покоління'); ax.grid(alpha=0.25)
    axs[0].set_ylabel('відносна частка перемог\n(1.0 = чесна 1/n)')
    axs[0].legend(fontsize=7, loc='lower right')
    fig.suptitle(title, fontsize=10.5); fig.tight_layout()
    p = os.path.join(D, name); fig.savefig(p, dpi=170); plt.close(fig); return p

def bars(name):
    if not val: return None
    fig, axs = plt.subplots(1, 2, figsize=(9.6, 3.2), sharey=True)
    for ax, dbl in zip(axs, [0, 1]):
        rows = [r for r in val['rows'] if r['dbl'] == dbl and r['opp'] == 'людиноподібні']
        x = range(len(rows)); w = 0.26
        for k, (lab, c) in enumerate([('v0.4', '#b8c2d3'), ('v0.5.0', '#7fa3d6'), ('v0.5.1', '#2f6db5')]):
            ax.bar([i + (k - 1) * w for i in x], [100 * r[lab] for r in rows], w, color=c, label=lab)
        ax.plot([i for i in x], [100 / r['n'] for r in rows], 'k_', ms=22, mew=1.6, label='чесна частка')
        ax.set_xticks(list(x)); ax.set_xticklabels([f"{r['n']} гравці" if r['n'] < 5 else f"{r['n']} гравців" for r in rows])
        ax.set_title('x2 ON' if dbl else 'x2 OFF', fontsize=10); ax.grid(axis='y', alpha=0.25)
    axs[0].set_ylabel('% перемог проти людиноподібних'); axs[0].legend(fontsize=7.5)
    fig.tight_layout(); p = os.path.join(D, name); fig.savefig(p, dpi=170); plt.close(fig); return p

story = []
story.append(Paragraph('Self-play, частина 2: арена й стійкі стратегії', H1))
story.append(Paragraph(f"Помічник richup.io · v0.5.1 · {fnd.get('date', '')}", S))
story.append(Spacer(1, 6))
for t in fnd.get('summary', []): story.append(Paragraph(t, P))
img = bars('arena-bars.png')
if img: story.append(Image(img, width=180 * mm, height=60 * mm))
story.append(Paragraph('Частка перемог бота-помічника за столом, де всі інші — людиноподібні боти (окремі seed, по 6000 партій на стовпчик).', S))

story.append(Paragraph('Що зроблено', H2))
for t in fnd.get('what', []): story.append(Paragraph(t, B, bulletText='•'))

story.append(PageBreak())
story.append(Paragraph('Було → стало: шанс перемоги', H2))
story.append(Paragraph('Перевірка на seed, яких пошук не бачив: 6000 партій на клітинку (95% ДІ ≈ ±1.2 п.п.). Чесна частка: 33.3% / 25% / 20% / 16.7%.', P))
if val:
    for dbl in [0, 1]:
        rows = [['Суперники', 'Гравців', 'v0.4 (до self-play)', 'v0.5.0', 'v0.5.1 (зараз)', 'Чесна']]
        for r in [r for r in val['rows'] if r['dbl'] == dbl]:
            rows.append([r['opp'], r['n'], pct(r['v0.4']), pct(r['v0.5.0']), pct(r['v0.5.1']), pct(r['fair'])])
        story.append(Paragraph('x2 оренда на повному наборі: ' + ('ON' if dbl else 'OFF'), ParagraphStyle('h3', parent=P, fontName='DVB')))
        story.append(table(rows, [52 * mm, 16 * mm, 30 * mm, 24 * mm, 28 * mm, 18 * mm]))
        story.append(Spacer(1, 5))

story.append(PageBreak())
story.append(Paragraph('Перехресна перевірка двома рушіями', H2))
for t in fnd.get('cross', []): story.append(Paragraph(t, P))
rows = [['Набір параметрів', 'x2', 'Арена: люди', 'Арена: люди+v0.5.0', 'evolve: люди', 'evolve: v0.4+люди']]
def addcross(v, label, key):
    if not v: return
    for dbl in [0, 1]:
        ar = {r['opp'] + str(r['n']): r for r in v['rows'] if r['dbl'] == dbl}
        def rel(opp):
            rs = [r for r in v['rows'] if r['dbl'] == dbl and r['opp'] == opp]
            return sum(r[key] * r['n'] for r in rs) / len(rs) if rs else None
        cr = {r['opp']: r for r in v['cross'] if r['dbl'] == dbl}
        f = lambda x: f'{x:.2f}' if x is not None else '—'
        rows.append([label, 'ON' if dbl else 'OFF', f(rel('людиноподібні')), f(rel('суміш (люди + v0.5.0)')),
                     f(cr.get('людиноподібні (evolve)', {}).get(key)), f(cr.get('v0.4 + людиноподібні (evolve)', {}).get(key))])
addcross(val, 'v0.4', 'v0.4'); addcross(val, 'v0.5.0', 'v0.5.0'); addcross(valA, 'лише арена (відкинуто)', 'v0.5.1'); addcross(val, 'v0.5.1 стійкий (вбудовано)', 'v0.5.1')
story.append(table(rows, [50 * mm, 10 * mm, 26 * mm, 32 * mm, 26 * mm, 30 * mm]))
story.append(Paragraph('Числа — відносна частка перемог (1.00 = чесна частка 1/n, середнє по столах 3–6). «evolve» — рушій першого self-play (tools/selfplay/engine.mjs) з його власними людиноподібними ботами.', S))

story.append(Paragraph('Еволюція фітнесу', H2))
c1 = chart('arena-evo-arena.png', ['arena-dbl0', 'arena-dbl1'], 'Пошук лише в арені (sep-CMA-ES, 40 поколінь × 16 × 1500 партій)')
story.append(Image(c1, width=180 * mm, height=62 * mm))
c2 = chart('arena-evo-robust.png', ['robust-dbl0', 'robust-dbl1'], 'Стійкий пошук: фітнес = середнє арени та evolve (32 покоління × 16 × 1200 партій × 2 рушії)')
story.append(Image(c2, width=180 * mm, height=62 * mm))
story.append(Paragraph('Фітнес покоління скаче, бо суперники з «залу слави» змінюються кожні 5 поколінь (стає важче). Червоні точки — контроль на одних і тих самих окремих seed проти людиноподібних і v0.5.0.', S))

story.append(PageBreak())
story.append(Paragraph('Відкриті питання (експерименти)', H2))
story.append(Paragraph('Кожен рядок — знайдена стратегія v0.5.1 з однією зміною. «Суміш» = столи 3–6 гравців з людиноподібними ботами й v0.5.0 (8000 партій), «люди» = лише людиноподібні (4000). Відносна частка перемог, 1.00 = чесна; ±0.05 — шум.', P))
if exp:
    for dbl in ['0', '1']:
        e = exp['dbl'].get(dbl)
        if not e: continue
        rows = [['Варіант', 'Суміш', 'Люди']]
        for k, v in e['variants'].items(): rows.append([k, f"{v['mix']:.2f}", f"{v['human']:.2f}"])
        story.append(KeepTogether([Paragraph('x2 ' + ('ON' if dbl == '1' else 'OFF'), ParagraphStyle('h3', parent=P, fontName='DVB')), table(rows, [100 * mm, 25 * mm, 25 * mm])]))
        story.append(Spacer(1, 4))
    for t in fnd.get('questions', []): story.append(Paragraph(t, B, bulletText='•'))

story.append(Paragraph('Правила для гри з друзями', H2))
for i, t in enumerate(fnd.get('rules', []), 1): story.append(Paragraph(t, B, bulletText=f'{i}.'))

story.append(Paragraph('Параметри помічника', H2))
pr = fnd.get('params')
if pr:
    rows = [['Параметр', 'Що означає', 'v0.4', 'v0.5.0 OFF/ON', 'v0.5.1 OFF/ON']] + pr
    story.append(table(rows, [24 * mm, 70 * mm, 16 * mm, 30 * mm, 30 * mm]))

story.append(Paragraph('Припущення й обмеження', H2))
for t in fnd.get('limits', []): story.append(Paragraph(t, B, bulletText='•'))

def onpage(c, d):
    c.saveState(); c.setFont('DV', 7.5); c.setFillColor(MUT)
    c.drawString(15 * mm, 10 * mm, 'Monopoly-Strategy · self-play арена · tools/selfplay/arena'); c.drawRightString(195 * mm, 10 * mm, str(d.page)); c.restoreState()
out = os.path.join(D, 'arena-report.pdf')
SimpleDocTemplate(out, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm, bottomMargin=16 * mm,
                  title='Self-play арена: стійкі стратегії', author='Claude').build(story, onFirstPage=onpage, onLaterPages=onpage)
print(out)
