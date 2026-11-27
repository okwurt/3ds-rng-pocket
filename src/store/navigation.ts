import { useCallback, useEffect, useRef, useState } from 'react';

export type ActiveGen = 'home' | 'gen7' | 'gen6';
export type AppTab = 'seed' | 'stationary' | 'wild' | 'egg' | 'more';
export type MoreSection = 'event' | 'id' | 'profiles' | 'tools';
export type NavigationSection = Exclude<AppTab, 'more'> | MoreSection;
export type SeedMode6 = 'mt' | 'timeline' | 'finder' | 'seedrun';

interface Navigation {
  activeGen: ActiveGen;
  activeTab: AppTab;
  moreSection: MoreSection;
  tab6: NavigationSection;
  more6: MoreSection;
  seedMode6: SeedMode6;
  depth: number;
}

const home: Navigation = {
  activeGen: 'home', activeTab: 'seed', moreSection: 'event',
  tab6: 'seed', more6: 'event', seedMode6: 'mt', depth: 0,
};

function isSecondary(section: NavigationSection): section is MoreSection {
  return section === 'event' || section === 'id' || section === 'profiles' || section === 'tools';
}

export function useNavigation() {
  const [navigation, setNavigation] = useState<Navigation>(() => window.history.state?.rngPocket ?? home);
  const current = useRef(navigation);

  useEffect(() => {
    function restore(event: PopStateEvent) {
      const entry: Navigation = event.state?.rngPocket ?? home;
      current.current = entry;
      setNavigation(entry);
    }
    if (!window.history.state?.rngPocket) {
      window.history.replaceState({ ...window.history.state, rngPocket: home }, '');
    }
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const navigate = useCallback((patch: Partial<Omit<Navigation, 'depth'>>) => {
    const entry = current.current;
    if (Object.keys(patch).every(key => entry[key as keyof typeof patch] === patch[key as keyof typeof patch])) return;
    const next = { ...entry, ...patch, depth: entry.depth + 1 };
    window.history.pushState({ ...window.history.state, rngPocket: next }, '');
    current.current = next;
    setNavigation(next);
  }, []);

  const setActiveGen = useCallback((gen: ActiveGen) => {
    const entry = current.current;
    if (gen === entry.activeGen) return;
    if (gen === 'home' && entry.depth > 0) {
      window.history.go(-entry.depth);
      return;
    }
    navigate({ activeGen: gen, activeTab: 'seed', tab6: 'seed', seedMode6: 'mt' });
  }, [navigate]);

  const setActiveTab = useCallback((tab: AppTab) => navigate({ activeTab: tab }), [navigate]);
  const selectSection7 = useCallback((section: NavigationSection) => {
    navigate(isSecondary(section) ? { activeTab: 'more', moreSection: section } : { activeTab: section });
  }, [navigate]);
  const selectSection6 = useCallback((section: NavigationSection, mode?: SeedMode6) => {
    navigate({
      tab6: section,
      ...(isSecondary(section) ? { more6: section } : {}),
      ...(mode ? { seedMode6: mode } : {}),
    });
  }, [navigate]);

  return { ...navigation, setActiveGen, setActiveTab, selectSection7, selectSection6 };
}
