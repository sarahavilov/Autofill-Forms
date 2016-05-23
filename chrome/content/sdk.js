/* global self */
'use strict';

function onchange (elem) {
  try {
    elem.dispatchEvent(new Event('change'));
    elem.dispatchEvent(new Event('keydown'));
    elem.dispatchEvent(new Event('keyup'));
    elem.dispatchEvent(new Event('keychange'));
  }
  catch (e) {}
}

function toList (att) {
  return [].concat.apply(
    [window.document],
    [].map.call(window.document.getElementsByTagName('iframe'), f => f.contentDocument)
  )
  .filter(doc => doc)
  .map(function (doc) {
    return [].slice.call(doc.querySelectorAll(att), 0);
  })
  .reduce(function (a, b) {
    return [].concat.call(a, b);
  });
}

self.port.on('click', function () {
  toList('[data-aff-click]').forEach(function (elem) {
    elem.removeAttribute('data-aff-click');
    elem.click();
  });
  self.port.emit('done');
});
self.port.on('submit', function () {
  toList('[data-aff-submit]').forEach(function (elem) {
    elem.removeAttribute('data-aff-submit');
    elem.submit();
  });
  self.port.emit('done');
});
self.port.on('focus', function () {
  toList('[data-aff-focus]').forEach(function (elem) {
    elem.removeAttribute('data-aff-focus');
    elem.focus();
    onchange(elem);
  });
  self.port.emit('done');
});
self.port.on('change', function () {
  toList('[data-aff-change]').forEach(function (elem) {
    elem.removeAttribute('data-aff-change');
    onchange(elem);
  });
  self.port.emit('done');
});
self.port.on('value', function () {
  toList('[data-aff-value]').forEach(function (elem) {
    elem.value = elem.dataset.affValue;
    elem.removeAttribute('data-aff-value');
    onchange(elem);
  });
  self.port.emit('done');
});
self.port.on('selectionEnd', function () {
  toList('[data-aff-selectionEnd]').forEach(function (elem) {
    elem.selectionEnd = elem.dataset.affSelectionend;
    elem.removeAttribute('data-aff-selectionEnd');
  });
  self.port.emit('done');
});
self.port.on('selectionStart', function () {
  toList('[data-aff-selectionStart]').forEach(function (elem) {
    elem.selectionStart = elem.dataset.affSelectionstart;
    elem.removeAttribute('data-aff-selectionstart');
  });
  self.port.emit('done');
});
