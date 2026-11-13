// `/` — where a signed-in person lands: the welcome page.
//
// It used to be no page at all: it replaced itself with the first screen of the person's menu.
// «عايز بقى أى حساب يدخل تظهرله Welcome Page» made it a place of its own — the greeting, the
// birthday and the pages the person was last on, each a link back. An account holding no screens
// yet is told so on the same page (`WelcomePage`), rather than on an empty one.
import { WelcomePage } from '../../home/WelcomePage';

export const LandingPage = (): JSX.Element => <WelcomePage />;
