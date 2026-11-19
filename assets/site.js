/* Two optional reads. Each source settles once, within four seconds. */
(() => {
  'use strict';
  const container = document.querySelector('[data-stats]');
  if (!container) return;
  const lang = document.documentElement.lang;
  const copy = {
    en: {active:['active installation','active installations'], total:['installation in total','installations in total'], sessions:['attended session','attended sessions'], stars:['GitHub star','GitHub stars'], forks:['GitHub fork','GitHub forks'], threshold:n=>`The total of sessions appears when at least ${n} active installations are counted.`},
    it: {active:['installazione attiva','installazioni attive'], total:['installazione in tutto','installazioni in tutto'], sessions:['sessione svolta','sessioni svolte'], stars:['stella su GitHub','stelle su GitHub'], forks:['fork su GitHub','fork su GitHub'], threshold:n=>`Il totale delle sessioni compare quando si contano almeno ${n} installazioni attive.`},
    es: {active:['instalación activa','instalaciones activas'], total:['instalación en total','instalaciones en total'], sessions:['sesión realizada','sesiones realizadas'], stars:['estrella en GitHub','estrellas en GitHub'], forks:['fork en GitHub','forks en GitHub'], threshold:n=>`El total de sesiones aparece a partir de ${n} instalaciones activas.`}
  }[lang] || null;
  if (!copy) return;
  const format = new Intl.NumberFormat(lang);
  const validCount = n => Number.isSafeInteger(n) && n >= 0;
  const note = value => { const p = document.createElement('p'); p.className = 'stats-note'; p.textContent = value; return p; };
  function list(items) {
    const ul = document.createElement('ul'); ul.className = 'stats-list';
    for (const [value, label] of items) {
      const li = document.createElement('li');
      const number = document.createElement('span'); number.className = 'stat-value'; number.textContent = format.format(value);
      const text = document.createElement('span'); text.className = 'stat-label'; text.textContent = copy[label][value === 1 ? 0 : 1];
      li.append(number, text); ul.append(li);
    }
    return ul;
  }
  async function read(url) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {const response = await fetch(url, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'}); if (!response.ok) throw new Error('HTTP'); return response.json();})(),
        new Promise((_, reject) => {timer = setTimeout(() => {controller.abort(); reject(new Error('Timeout'));}, 4000);})
      ]);
    } finally {clearTimeout(timer);}
  }
  async function update() {
    const results = await Promise.allSettled([
      read('https://approdo-stats.nerln.workers.dev/stats.json'),
      read('https://api.github.com/repos/nerln/approdo')
    ]);
    const fragment = document.createDocumentFragment();
    const stats = results[0].status === 'fulfilled' ? results[0].value : null;
    if (stats && validCount(stats.installs?.active) && validCount(stats.installs?.total) && stats.installs.total >= stats.installs.active && validCount(stats.minInstallsForSessions) && stats.minInstallsForSessions >= 3 && (stats.sessions === null || validCount(stats.sessions))) {
      const items = [];
      if (stats.installs.active > 0) items.push([stats.installs.active,'active']);
      if (stats.installs.total > stats.installs.active) items.push([stats.installs.total,'total']);
      if (stats.installs.active >= stats.minInstallsForSessions && stats.sessions !== null) items.push([stats.sessions,'sessions']);
      if (items.length) fragment.append(list(items));
      if (items.length && (stats.sessions === null || stats.installs.active < stats.minInstallsForSessions)) fragment.append(note(copy.threshold(format.format(stats.minInstallsForSessions))));
    }
    const github = results[1].status === 'fulfilled' ? results[1].value : null;
    if (github) {
      const items = [[github.stargazers_count,'stars'],[github.forks_count,'forks']]
        .filter(([value]) => validCount(value) && value > 0);
      if (items.length) fragment.append(list(items));
    }
    if (fragment.childNodes.length) container.replaceChildren(fragment);
  }
  update().catch(() => {});
})();
