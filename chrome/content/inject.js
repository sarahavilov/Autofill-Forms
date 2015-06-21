/* globals addMessageListener, content */
'use strict';

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
  });
});
