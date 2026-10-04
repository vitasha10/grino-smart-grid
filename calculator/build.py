# Build FeederCheck page: template + feeders.json; prefill English text so the page is readable even before JS runs.
import re, json
t = open('template.html', encoding='utf-8').read()
en_block = t.split('en:{', 1)[1].split('\nhy:{', 1)[0]
en = dict(re.findall(r'(\w+):"([^"]*)"', en_block))
cnt = 0
def rep(m):
    global cnt
    k = m.group(1)
    if k in en:
        cnt += 1
        return 'data-i="%s">%s</' % (k, en[k])
    return m.group(0)
t2 = re.sub(r'data-i="(\w+)"></', rep, t)
feeders = json.load(open('feeders.json', encoding='utf-8'))
html = t2.replace('__FEEDERS__', json.dumps(feeders, ensure_ascii=False, separators=(',', ':')))
note = '<noscript><p style="padding:12px;background:#fde7e7;color:#7a1c1c;margin:0">This calculator needs JavaScript. Open the file in Chrome, Edge or Firefox on a laptop (double-click), not in the Telegram file preview.</p></noscript>\n<header>'
html = html.replace('<header>', note, 1)
for name in ('index.html', 'FeederCheck_calculator.html'):
    open(name, 'w', encoding='utf-8').write(html)
print('static texts filled:', cnt, 'size', len(html))
