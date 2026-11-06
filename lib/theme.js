// Dark mode's remembered choice (components/ThemeSwitch.jsx, 6 Nov 2026).
//
// Not in ThemeSwitch.jsx on purpose: that is a 'use client' file, and the root
// layout (a server component) importing a string from it receives a stand-in
// for client code, not the string -- the <head> script then held a function's
// source and never ran, so dark mode was lost on every page load (code
// review, 6 Nov 2026). Shared values live here.
export const THEME_KEY = 'l14-theme';

// Run in <head> before the page paints: puts back the remembered choice, so a
// dark page never flashes white.
export const THEME_SCRIPT = `try{if(localStorage.getItem('${THEME_KEY}')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;
