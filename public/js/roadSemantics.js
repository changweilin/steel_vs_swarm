import { isPedestrianWay } from './pedestrian.js';

export const structuralTunnel = tags => !!tags?.tunnel && (tags.indoor == null || tags.indoor === 'no')
  && !isPedestrianWay(tags);
