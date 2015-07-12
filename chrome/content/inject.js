/* globals addMessageListener, content */
'use strict';

function onchange (elem) {
  var evt = content.document.createEvent('HTMLEvents');
  evt.initEvent('change', true, true);
  elem.dispatchEvent(evt);
}

addMessageListener('click', function () {
  var elems = content.document.querySelectorAll('[data-aff-click=true]');
  [].forEach.call(elems, function (elem) {
    elem.removeAttribute('data-aff-click');
    elem.click();
  });
});
addMessageListener('submit', function () {
  var elems = content.document.querySelectorAll('[data-aff-submit=true]');
  [].forEach.call(elems, function (elem) {
    elem.removeAttribute('data-aff-submit');
    elem.submit();
  });
});
addMessageListener('focus', function () {
  var elems = content.document.querySelectorAll('[data-aff-focus=true]');
  [].forEach.call(elems, function (elem) {
    elem.removeAttribute('data-aff-focus');
    elem.focus();
    onchange(elem);
  });
});
addMessageListener('value', function () {
  var elems = content.document.querySelectorAll('[data-aff-value]');
  [].forEach.call(elems, function (elem) {
    elem.value = elem.dataset.affValue;
    elem.removeAttribute('data-aff-value');
    onchange(elem);
  });
});
addMessageListener('selectionEnd', function () {
  var elems = content.document.querySelectorAll('[data-aff-selectionEnd]');
  [].forEach.call(elems, function (elem) {
    elem.selectionEnd = elem.dataset.affSelectionEnd;
    elem.removeAttribute('data-aff-selectionEnd');
  });
});
addMessageListener('selectionStart', function () {
  var elems = content.document.querySelectorAll('[data-aff-selectionStart]');
  [].forEach.call(elems, function (elem) {
    elem.selectionStart = elem.dataset.affSelectionStart;
    elem.removeAttribute('data-aff-selectionStart');
  });
});
