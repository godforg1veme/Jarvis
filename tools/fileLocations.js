const path = require('path');

const LOCATION_ALIASES = [
  { id: 'desktop', aliases: ['desktop', 'рабочий стол', 'рабочем столе', 'на рабочем столе'] },
  { id: 'downloads', aliases: ['downloads', 'download', 'загрузки', 'загрузках', 'в загрузках'] },
  { id: 'documents', aliases: ['documents', 'document', 'документы', 'документах', 'в документах'] },
  { id: 'pictures', aliases: ['pictures', 'images', 'изображения', 'картинки', 'фото'] },
  { id: 'videos', aliases: ['videos', 'video', 'видео'] },
  { id: 'music', aliases: ['music', 'музыка', 'музыке'] },
  { id: 'home', aliases: ['home', 'user', 'домашняя папка', 'папка пользователя'] },
  { id: 'computer', aliases: ['computer', 'pc', 'на пк', 'на компьютере', 'везде', 'не помню где'] },
];

const LOCATION_DIRS = {
  desktop: 'Desktop',
  downloads: 'Downloads',
  documents: 'Documents',
  pictures: 'Pictures',
  videos: 'Videos',
  music: 'Music',
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocation(input) {
  const text = normalizeText(input);
  if (!text) return '';

  for (const entry of LOCATION_ALIASES) {
    if (entry.aliases.some((alias) => text.includes(normalizeText(alias)))) {
      return entry.id;
    }
  }

  return '';
}

function isBroadLocation(location) {
  return location === 'computer';
}

function getUserProfile(env = process.env) {
  return env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : '');
}

function resolveLocationPath(location, env = process.env) {
  const userProfile = getUserProfile(env);
  if (!userProfile) return '';
  if (location === 'home') return userProfile;

  const dirName = LOCATION_DIRS[location];
  return dirName ? path.join(userProfile, dirName) : '';
}

function getStandardLocations(env = process.env) {
  return ['desktop', 'downloads', 'documents', 'pictures', 'videos', 'music', 'home']
    .map((id) => ({ id, path: resolveLocationPath(id, env) }))
    .filter((entry) => entry.path);
}

module.exports = {
  normalizeText,
  normalizeLocation,
  isBroadLocation,
  resolveLocationPath,
  getStandardLocations,
};
