// AI Study Buddy appearance preferences. Visual-only: never affects auth, billing or AI access.
(() => {
  'use strict';

  const STORAGE_KEY = 'studybuddy-theme-v1';
  const themes = [
    {id:'midnight-ocean',name:'Midnight Ocean',detail:'The original deep-blue Study Buddy look.',
      background:'#171c27',surface:'#212938',accent:'#4489fa'},
    {id:'aurora-borealis',name:'Aurora Borealis',detail:'Teal and northern-light greens.',
      background:'#0c1b21',surface:'#192f36',accent:'#50dcc3'},
    {id:'velvet-nebula',name:'Velvet Nebula',detail:'Cosmic purple with soft lavender.',
      background:'#181324',surface:'#29213b',accent:'#b99aff'},
    {id:'ember-horizon',name:'Ember Horizon',detail:'Warm charcoal and sunset orange.',
      background:'#221a19',surface:'#322724',accent:'#ffab70'},
    {id:'evergreen-grove',name:'Evergreen Grove',detail:'Calm pine and moss-green tones.',
      background:'#111d18',surface:'#203429',accent:'#8dd6a0'},
    {id:'crimson-dusk',name:'Crimson Dusk',detail:'Burgundy with glowing coral accents.',
      background:'#23151d',surface:'#38232f',accent:'#ff829a'},
    {id:'eclipse-gold',name:'Eclipse Gold',detail:'Minimal charcoal with warm gold.',
      background:'#17191b',surface:'#25282b',accent:'#eec56c'},
    {id:'arctic-frost',name:'Arctic Frost',detail:'Bright ice-blue daylight mode.',
      background:'#ecf5fb',surface:'#ffffff',accent:'#3677ba'},
    {id:'coastal-sand',name:'Coastal Sand',detail:'Warm cream and terracotta daylight mode.',
      background:'#f6f0e5',surface:'#fffaf2',accent:'#a46539'},
    {id:'sakura-dream',name:'Sakura Dream',detail:'Soft blush and plum daylight mode.',
      background:'#fff0f5',surface:'#ffffff',accent:'#a64b83'}
  ];
  const byId = new Map(themes.map(theme => [theme.id, theme]));
  let current = 'midnight-ocean';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (byId.has(stored)) current = stored;
  } catch {
    // Private browsing or restrictive browser settings may disallow storage.
  }

  function setTheme(id, persist) {
    const theme = byId.get(id) || themes[0];
    current = theme.id;
    document.documentElement.setAttribute('data-theme', theme.id);
    const tint = document.querySelector('meta[name="theme-color"]');
    if (tint) tint.setAttribute('content', theme.background);
    let saved = true;
    if (persist) {
      try { window.localStorage.setItem(STORAGE_KEY, theme.id); }
      catch { saved = false; }
    }
    const currentLabel = document.getElementById('theme-current');
    if (currentLabel) currentLabel.textContent = theme.name;
    const status = document.getElementById('theme-save-status');
    if (status) status.textContent = saved
      ? theme.name + ' selected. Your theme is saved on this device.'
      : theme.name + ' selected for this session. This browser could not save your choice.';
    const picker = document.getElementById('theme-picker');
    if (picker) {
      picker.querySelectorAll('[data-theme-choice]').forEach(button => {
        const chosen = button.getAttribute('data-theme-choice') === theme.id;
        button.setAttribute('aria-pressed', String(chosen));
        const check = button.querySelector('.theme-check');
        if (check) check.textContent = chosen ? '✓ Selected' : 'Select';
      });
    }
  }

  // Set the palette before stylesheets paint: prevents a flash of the default theme.
  setTheme(current, false);

  function buildThemePicker() {
    const picker = document.getElementById('theme-picker');
    if (!picker) return;
    const fragment = document.createDocumentFragment();
    for (const theme of themes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-choice';
      button.setAttribute('data-theme-choice', theme.id);
      button.setAttribute('aria-label', 'Use ' + theme.name + ' theme');
      button.setAttribute('aria-pressed', String(theme.id === current));

      const sample = document.createElement('span');
      sample.className = 'theme-sample';
      sample.setAttribute('aria-hidden', 'true');
      sample.style.setProperty('--sample-bg', theme.background);
      sample.style.setProperty('--sample-surface', theme.surface);
      sample.style.setProperty('--sample-accent', theme.accent);
      const samplePanel = document.createElement('span');
      samplePanel.className = 'theme-sample-panel';
      const sampleBar = document.createElement('span');
      sampleBar.className = 'theme-sample-bar';
      samplePanel.append(sampleBar);
      sample.append(samplePanel);

      const copy = document.createElement('span');
      copy.className = 'theme-copy';
      const name = document.createElement('strong');
      name.textContent = theme.name;
      const description = document.createElement('small');
      description.textContent = theme.detail;
      const selection = document.createElement('span');
      selection.className = 'theme-check';
      selection.textContent = theme.id === current ? '✓ Selected' : 'Select';
      copy.append(name, description, selection);
      button.append(sample, copy);
      button.addEventListener('click', () => setTheme(theme.id, true));
      fragment.append(button);
    }
    picker.replaceChildren(fragment);
    setTheme(current, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildThemePicker, {once:true});
  } else {
    buildThemePicker();
  }
})();
