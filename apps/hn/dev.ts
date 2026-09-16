import { mount } from './main'

// Development harness: loads the synthetic front page and mounts the script on it, so the app can
// be worked on without the real site.
const response = await fetch('/fixture.html')
const fixture = new DOMParser().parseFromString(await response.text(), 'text/html')
document.body.replaceChildren(...Array.from(fixture.body.childNodes))
const page = document.querySelector('#hnmain')
if (page) mount(page)
