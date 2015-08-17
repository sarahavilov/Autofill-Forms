/* globals addMessageListener, content */
'use strict';

function onchange (elem) {
  try {
    var evt = content.document.createEvent('HTMLEvents');
    evt.initEvent('change', true, true);
    elem.dispatchEvent(evt);
  }
  catch (e) {}
}

function toList (att) {
  return [].concat.apply(
    [content.document],
    [].map.call(content.document.getElementsByTagName('iframe'), f => f.contentDocument)
  )
  .map(function (doc) {
    return [].slice.call(doc.querySelectorAll(att), 0);
  })
  .reduce(function (a, b) {
    return [].concat.call(a, b);
  });
}

addMessageListener('click', function () {
  toList('[data-aff-click=true]').forEach(function (elem) {
    elem.removeAttribute('data-aff-click');
    elem.click();
  });
});
addMessageListener('submit', function () {
  toList('[data-aff-submit=true]').forEach(function (elem) {
    elem.removeAttribute('data-aff-submit');
    elem.submit();
  });
});
addMessageListener('focus', function () {
  toList('[data-aff-focus=true]').forEach(function (elem) {
    elem.removeAttribute('data-aff-focus');
    elem.focus();
    onchange(elem);
  });
});
addMessageListener('change', function () {
  toList('[data-aff-change=true]').forEach(function (elem) {
    elem.removeAttribute('data-aff-change');
    onchange(elem);
  });
});
addMessageListener('value', function () {
  toList('[data-aff-value]').forEach(function (elem) {
    elem.value = elem.dataset.affValue;
    elem.removeAttribute('data-aff-value');
    onchange(elem);
  });
});
addMessageListener('selectionEnd', function () {
  toList('[data-aff-selectionEnd]').forEach(function (elem) {
    elem.selectionEnd = elem.dataset.affSelectionEnd;
    elem.removeAttribute('data-aff-selectionEnd');
  });
});
addMessageListener('selectionStart', function () {
  toList('[data-aff-selectionStart]').forEach(function (elem) {
    elem.selectionStart = elem.dataset.affSelectionStart;
    elem.removeAttribute('data-aff-selectionStart');
  });
});
