# HUB i18n merge (build-cl): wc.json + wl.json + HUB's own bar words into apps/web/.../i18n.ts.
import json, sys
I18N = '/home/user/egycash-dash/apps/web/src/platform/localization/i18n.ts'
D = '/tmp/claude-0/-home-user/85f289ec-521b-5944-9b89-a0120b22d71a/scratchpad/stitch-dash/build-cl/i18n'
wc = json.load(open(f'{D}/wc.json'))
wl = json.load(open(f'{D}/wl.json'))

def quote(v):
    if "'" in v and '"' not in v:
        return '"' + v + '"'
    if "'" in v:
        return "'" + v.replace("'", "\\'") + "'"
    return "'" + v + "'"

def entry(k, v):
    one = f"  '{k}': {quote(v)},"
    if len(one) <= 100:
        return [one]
    return [f"  '{k}':", f"    {quote(v)},"]

lines = open(I18N).read().split('\n')
def region(locale):
    start = next(i for i, l in enumerate(lines) if l.startswith(f'const {locale}: Record<string, string> = {{'))
    end = next(i for i in range(start + 1, len(lines)) if lines[i] == '};')
    return start, end

def span(locale, key):
    s, e = region(locale)
    for i in range(s, e):
        if lines[i].startswith(f"  '{key}':"):
            j = i
            while not (lines[j].rstrip().endswith("',") or lines[j].rstrip().endswith('",')):
                j += 1
            return i, j + 1
    return None

def delete(locale, key):
    sp = span(locale, key)
    if sp is None:
        sys.exit(f'missing {locale} {key}')
    del lines[sp[0]:sp[1]]

def setv(locale, key, v):
    sp = span(locale, key)
    if sp is None:
        sys.exit(f'missing {locale} {key}')
    lines[sp[0]:sp[1]] = entry(key, v)

def insert_after(locale, anchor, pairs):
    sp = span(locale, anchor)
    if sp is None:
        sys.exit(f'missing anchor {locale} {anchor}')
    new = []
    for k, v in pairs:
        if span(locale, k) is not None:
            sys.exit(f'collision {locale} {k}')
        new += entry(k, v)
    lines[sp[1]:sp[1]] = new

def insert_before(locale, anchor, pairs):
    sp = span(locale, anchor)
    new = []
    for k, v in pairs:
        if span(locale, k) is not None:
            sys.exit(f'collision {locale} {k}')
        new += entry(k, v)
    lines[sp[0]:sp[0]] = new

HUB = {
    'ar': {'fleet.dash.shell.tab.custody': 'العهدة', 'fleet.dash.shell.tab.licences': 'التراخيص والتجديدات'},
    'en': {'fleet.dash.shell.tab.custody': 'Custody', 'fleet.dash.shell.tab.licences': 'Licences and renewals'},
}
for loc in ('en', 'ar'):
    # the bar
    setv(loc, 'fleet.dash.shell.tab.licences', HUB[loc]['fleet.dash.shell.tab.licences'])
    insert_after(loc, 'fleet.dash.shell.tab.fuel', [('fleet.dash.shell.tab.custody', HUB[loc]['fleet.dash.shell.tab.custody'])])
    delete(loc, 'fleet.dash.shell.tabShort.licences')
    # the old licences body's words nobody reads any more
    for k in wl['dropRead']:
        delete(loc, k)
    for k, v in wl['change'].items():
        setv(loc, k, v[loc])
    # «التراخيص والتجديدات»: after its kept `expiredToday`
    lic = [(k, v) for k, v in wl[loc].items() if k.startswith('fleet.dash.licences.')]
    insert_after(loc, 'fleet.dash.licences.expiredToday', lic)
    # «العهدة»: its own block, just before the licences tab's
    insert_before(loc, 'fleet.dash.licences.sub', list(wc[loc].items()))
    # LicensingPage's paper chip, beside the board's own paper counts
    pap = [(k, v) for k, v in wl[loc].items() if k.startswith('fleet.licensing.')]
    insert_after(loc, 'fleet.licensing.stats.taxOut', pap)

open(I18N, 'w').write('\n'.join(lines))
print('ok')
