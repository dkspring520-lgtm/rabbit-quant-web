import React from 'react';
/** XHTML children embedded in SVG foreignObject retain their explicit namespace.
 * @param {import('react').HTMLAttributes<HTMLDivElement> & {xmlns:'http://www.w3.org/1999/xhtml'}} props
 */
export function XhtmlDiv(props) { return React.createElement('div',props); }
