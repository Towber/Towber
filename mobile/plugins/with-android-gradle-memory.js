const { withGradleProperties } = require('@expo/config-plugins');

const LOCAL_BUILD_PROPERTIES = {
  'org.gradle.jvmargs': '-Xmx2048m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8',
  'org.gradle.workers.max': '2',
};

module.exports = function withAndroidGradleMemory(config) {
  if (process.env.TOWBER_LOCAL_ANDROID_BUILD !== '1') return config;

  return withGradleProperties(config, (modConfig) => {
    for (const [key, value] of Object.entries(LOCAL_BUILD_PROPERTIES)) {
      const existing = modConfig.modResults.find(
        (property) => property.type === 'property' && property.key === key,
      );
      if (existing) existing.value = value;
      else modConfig.modResults.push({ type: 'property', key, value });
    }
    return modConfig;
  });
};
