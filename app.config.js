const appJson = require('./app.json');

module.exports = () => {
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL || '';
  const expo = appJson.expo;
  return {
    ...expo,
    web: {
      ...expo.web,
      output: 'single',
      name: 'Tuck',
      shortName: 'Tuck',
    },
    experiments: {
      ...(expo.experiments || {}),
      ...(baseUrl ? { baseUrl } : {}),
    },
  };
};
