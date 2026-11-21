import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import Boundary from '../dist/tests/components/PrivateWorkspaceBoundary.js';

/** Presentation-only unit fixture; this never represents verified network/server authority.
 * First assert the real entry stays gated, then retain its existing approved-view markup checks.
 * Actual readiness/expiry is exercised separately by controller and production-browser tests.
 */
export function renderAfterVerifiedLease(workspace) {
  const boundary = workspace.type(workspace.props);
  assert.equal(boundary.type, Boundary, 'private workspace must enter through the access gate');
  const pending = renderToStaticMarkup(boundary);
  assert.match(pending, /Checking current private access/);
  assert.doesNotMatch(pending, /<(?:input|textarea|img|form)\b/);
  return renderToStaticMarkup(boundary.props.children);
}
