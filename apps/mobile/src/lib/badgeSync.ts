import { AppState, type AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useNotifications } from './notifications';

type Role = 'admin' | 'user';

// SDK 56: shouldShowAlert replaced by shouldShowBanner + shouldShowList.
// Register at module load (app/index.tsx imports this synchronously)
// so a push arriving before setupBadgeSync runs still surfaces.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function updateAppBadgeCount(count: number): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch (err) {
    console.warn('[sonoqui] setBadgeCountAsync failed', err);
  }
}

export function setupBadgeSync(role: Role): () => void {
  if (Platform.OS === 'web') return () => {};

  const refresh = () => useNotifications.getState().refresh(role);

  // Mirror in-app unread count to OS badge whenever it changes
  // (markAsRead, markAllAsRead, refresh result, etc.).
  const unsubStore = useNotifications.subscribe((state, prev) => {
    if (state.unreadCount !== prev.unreadCount) {
      void updateAppBadgeCount(state.unreadCount);
    }
  });

  // On foreground, count may be stale (read on web, pushes received
  // while backgrounded). Refetch from server to reconcile.
  const appStateSub = AppState.addEventListener(
    'change',
    (next: AppStateStatus) => {
      if (next === 'active') void refresh();
    }
  );

  // Foreground push: re-pull from server (correction-requests is
  // source of truth; OS just bumped the badge).
  const receivedSub = Notifications.addNotificationReceivedListener(() => {
    void refresh();
  });

  // Tap from background/cold-start: reconcile after navigation.
  const responseSub = Notifications.addNotificationResponseReceivedListener(
    () => {
      void refresh();
    }
  );

  // Initial sync.
  void refresh().then(() => {
    void updateAppBadgeCount(useNotifications.getState().unreadCount);
  });

  return () => {
    unsubStore();
    appStateSub.remove();
    receivedSub.remove();
    responseSub.remove();
  };
}
