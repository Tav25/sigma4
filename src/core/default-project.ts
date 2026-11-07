import sample from '../data/default-project.sigma4.json'
import { parseProject } from './project-store'

/** The user's reference is retained byte-for-byte; normal import rebuilds derived timber. */
export function createDefaultProject() {
  return parseProject(JSON.stringify(sample))
}
