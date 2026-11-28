// Adds the build-time settings that app.json can't hold on its own.
//
// - EAS_PROJECT_ID: the Expo project id. It sets where over-the-air updates come from
//   (https://u.expo.dev/<id>). The GitHub workflow passes it from the repository variable of the
//   same name; it can also be written into app.json as expo.extra.eas.projectId.
// - APP_VERSION / APP_VERSION_CODE: set by the release workflow so every APK on GitHub Releases has
//   its own version (1.0.<n>) and a higher versionCode, which Obtainium and Android need to see an
//   update. Versions are left out of the runtime fingerprint, so changing them never blocks an
//   over-the-air update.
module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const versionCode = Number(process.env.APP_VERSION_CODE);

  return {
    ...config,
    version: process.env.APP_VERSION || config.version,
    android: {
      ...config.android,
      ...(Number.isInteger(versionCode) && versionCode > 0 ? { versionCode } : {}),
    },
    ...(projectId
      ? {
          extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } },
          updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` },
        }
      : {}),
  };
};
