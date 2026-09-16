import { mount } from './main'

// Entry for the built userscript. The banner is added by the build (vite.config.ts).
const page = document.querySelector('#hnmain')
if (page) mount(page)
