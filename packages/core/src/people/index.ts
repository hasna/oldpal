/**
 * People module exports
 * Human participants in the assistants ecosystem
 */

export { PeopleStore } from './store';
export { PeopleManager, createPeopleManager } from './manager';
export type {
  Person,
  PersonListItem,
  PersonStatus,
  MemberType,
  CreatePersonOptions,
} from './types';
