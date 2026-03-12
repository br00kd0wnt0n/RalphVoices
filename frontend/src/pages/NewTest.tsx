import { useSearchParams } from 'react-router-dom';
import { ConceptFirst } from './ConceptFirst';
import { PersonaFirst } from './PersonaFirst';

export function NewTest() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || 'concept-first';

  return mode === 'persona-first' ? <PersonaFirst /> : <ConceptFirst />;
}
