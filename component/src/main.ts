// Module federation needs the real bootstrap behind a dynamic import.
import('./bootstrap').catch(err => console.error(err));
