import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {XhtmlDiv} from '../app/xhtml-div.mjs';

test('foreignObject content retains XHTML namespace, children and attributes',()=>{
  const html=renderToStaticMarkup(React.createElement('svg',null,
    React.createElement('foreignObject',null,React.createElement(XhtmlDiv,
      {xmlns:'http://www.w3.org/1999/xhtml',className:'tooltip'},'example'))));
  assert.equal(html,'<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" class="tooltip">example</div></foreignObject></svg>');
});
