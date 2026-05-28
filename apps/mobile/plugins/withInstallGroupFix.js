// Fix for AD-joined Macs where primary group is "Domain Users" (contains a space),
// which breaks Xcode's SetOwnerAndGroup phase:
//   chown: ARCHITM\Domain Users: illegal group name
// Clearing INSTALL_OWNER and INSTALL_GROUP makes Xcode skip the chown step.
// Must be applied only to the target-level configurations, not the project-level
// ones, otherwise Xcode runs SetGroup twice on the .app and produces a
// "Cycle inside sonoQui" dependency-cycle error.
const { withXcodeProject } = require('@expo/config-plugins');

const withInstallGroupFix = (config) => {
  return withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults;
    const allConfigs = proj.pbxXCBuildConfigurationSection();

    // Find the project-level build configuration UUIDs so we can exclude them.
    const projectSection = proj.pbxProjectSection();
    const projectListRefs = new Set(
      Object.values(projectSection)
        .filter((v) => v && typeof v === 'object' && v.buildConfigurationList)
        .map((v) => v.buildConfigurationList)
    );
    const configListSection = proj.pbxXCConfigurationList();
    const projectLevelConfigUUIDs = new Set();
    for (const listKey of Object.keys(configListSection)) {
      if (!projectListRefs.has(listKey)) continue;
      const list = configListSection[listKey];
      if (!list || !Array.isArray(list.buildConfigurations)) continue;
      for (const entry of list.buildConfigurations) {
        if (entry && entry.value) projectLevelConfigUUIDs.add(entry.value);
      }
    }

    for (const key of Object.keys(allConfigs)) {
      if (projectLevelConfigUUIDs.has(key)) continue;
      const entry = allConfigs[key];
      if (entry && entry.buildSettings) {
        entry.buildSettings.INSTALL_OWNER = '""';
        entry.buildSettings.INSTALL_GROUP = '""';
      }
    }
    return cfg;
  });
};

module.exports = withInstallGroupFix;
