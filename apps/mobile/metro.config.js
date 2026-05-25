// Expo monorepo Metro config — watch workspace root + resolve hoisted deps
// + map `.js` import suffix to `.ts`/`.tsx` source (shared package convention).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enablePackageExports = false;

// Map `.js` suffix to `.ts`/`.tsx` when source is in @sonoqui/shared workspace.
const sharedRoot = path.resolve(workspaceRoot, 'packages/shared');
const originalResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js')) {
    const callerDir = path.dirname(context.originModulePath ?? '');
    const candidate = path.resolve(callerDir, moduleName);
    if (callerDir.startsWith(sharedRoot)) {
      const ts = candidate.replace(/\.js$/, '.ts');
      const tsx = candidate.replace(/\.js$/, '.tsx');
      if (fs.existsSync(ts)) {
        return { type: 'sourceFile', filePath: ts };
      }
      if (fs.existsSync(tsx)) {
        return { type: 'sourceFile', filePath: tsx };
      }
    }
  }
  if (originalResolve) return originalResolve(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
