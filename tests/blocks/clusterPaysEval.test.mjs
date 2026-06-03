/**
 * tests/blocks/clusterPaysEval.test.mjs — Wave M1
 */
import {
  defaultConfig, resolveConfig, emitClusterPaysEvalRuntime,
} from '../../src/blocks/clusterPaysEval.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== clusterPaysEval block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default minCluster=5', d.minCluster === 5);
t('default bucketEdges 5/8/10/12/15', JSON.stringify(d.bucketEdges) === '[5,8,10,12,15]');
t('default diagonal=false', d.diagonal === false);

const r = resolveConfig({ features: [{ kind: 'cluster_pays' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({ topology: { kind: 'cluster', evaluation: 'cluster' } });
t('auto-enable from cluster topology', r2.enabled === true);

const r3 = resolveConfig({
  features: [{ kind: 'cluster_pays' }],
  clusterPaysEval: { minCluster: 4, bucketEdges: [4, 7, 10], diagonal: true, maxEvents: 12 },
});
t('override minCluster', r3.minCluster === 4);
t('override bucketEdges', JSON.stringify(r3.bucketEdges) === '[4,7,10]');
t('override diagonal', r3.diagonal === true);
t('override maxEvents', r3.maxEvents === 12);

t('runtime stub when disabled', emitClusterPaysEvalRuntime(defaultConfig()).includes('disabled'));
const rt = emitClusterPaysEvalRuntime(r);
t('runtime exposes detectClusterWins', rt.includes('window.detectClusterWins'));
t('runtime bakes CLUSTER_MIN', rt.includes('CLUSTER_MIN          = 5'));
t('runtime bakes bucket edges', rt.includes('CLUSTER_BUCKET_EDGES = [5,8,10,12,15]'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
