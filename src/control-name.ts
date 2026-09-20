export function observedName(name: string): RegExp {
  const characters = [...name.replace(/\s/g, '')].map(character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('^\\s*' + characters.join('\\s*') + '\\s*$');
}
