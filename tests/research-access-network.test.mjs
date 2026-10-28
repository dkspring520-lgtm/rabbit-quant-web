import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('both research services retain internal isolation network and explicit loopback access network',()=>{
  const text=readFileSync(new URL('../deploy/paperclip/compose.yml',import.meta.url),'utf8');
  const services=text.split(/^networks:/m)[0];
  for(const service of ['paperclip','research-bridge']){
    const block=services.split(`  ${service}:`)[1].split(/^  [a-z][\w-]*:/m)[0];
    assert.match(block,/networks:\s*\n\s+- research-control\s*\n\s+- research-access/);
    assert.match(block,/ports:\s*\n\s+- "127\.0\.0\.1:\$\{/);
    assert.doesNotMatch(block,/network_mode:\s*host|privileged:\s*true/);
  }
  assert.match(text,/research-control:\s*\n\s+internal: true/);
  assert.match(text,/research-access:\s*\n\s+driver: bridge\s*\n\s+internal: false/);
  assert.match(text,/com\.docker\.network\.bridge\.gateway_mode_ipv4: nat/);
  assert.doesNotMatch(text,/nat-unprotected|trusted_host_interfaces|allow-direct-routing/);
});
