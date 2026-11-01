// Real modal, inline stylesheet and event handlers. API loading for the copy tab is outside this layout fixture.
import { configureLmsHtmlEditor, importLmsHtmlFile, mountLmsHtml, validateLmsHtml } from '../../js/lms-html.mjs';
const data = await (await fetch('/__test__/html/data')).json();
const style = document.createElement('style'); style.textContent = data.creatorStyle; document.head.append(style);
const root = document.createElement('div'); root.innerHTML = data.creator + data.preview; document.body.append(root);
const notify = (title, message) => { document.getElementById('demo-notice').textContent = `${title}: ${message}`; };
window.importLmsHtmlFile = input => importLmsHtmlFile(input, notify);
window.refreshLmsMaterialCardsState = () => {};
window.updateLmsSaveButtonLabel = () => {};
window.initLmsCopyTabState = () => {};
new Function('configureLmsHtmlEditor', 'mountLmsHtml', 'validateLmsHtml', 'showToast',
    `let currentLmsCreatorMode = 'create'; ${data.creatorHandlers}`)(configureLmsHtmlEditor, mountLmsHtml, validateLmsHtml, notify);
document.getElementById('modal-lms-creator').classList.remove('hidden');
document.getElementById('lms-wizard-step-1').classList.add('hidden');
document.getElementById('footer-wizard-step-1').classList.add('hidden');
document.getElementById('lms-wizard-step-2').classList.remove('hidden');
document.getElementById('footer-wizard-step-2').classList.remove('hidden');
document.getElementById('label-selected-topic-title').textContent = 'Pembelajaran WFH';
document.getElementById('lms-creator-target-label').textContent = 'X-1 • IPA';
window.updateResourcePlaceholder(document.querySelector('.lms-material-card'));
window.demoReady = true;
