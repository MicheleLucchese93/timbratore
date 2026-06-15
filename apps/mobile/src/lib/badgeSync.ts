import { AppState, type AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useNotifications } from './notifications';

// Deep-link a tapped push to the right tab based on its `data.kind`. New-doc
// pushes carry { kind:'document', document_id } — route to the Documents tab.
// Unknown / missing kinds are ignored (the badge refresh still runs).
function routeFromNotification(
  response: Notifications.NotificationResponse | null
): void {
  const data = response?.notification.request.content.data as
    | { kind?: string }
    | undefined;
  if (data?.kind === 'document') {
    // Defer so navigation runs after the tree (and tabs) is mounted on a
    // cold-start tap; a synchronous navigate can land before the router is ready.
    setTimeout(() => {
      try {
        router.navigate('/documenti');
      } catch {
        /* router not ready / not authenticated — ignore */
      }
    }, 0);
  }
}

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

export function setupBadgeSync(): () => void {
  if (Platform.OS === 'web') return () => {};

  const refresh = () => useNotifications.getState().refresh();

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

  // Tap from background/foreground: reconcile and deep-link to the right tab.
  const responseSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      void refresh();
      routeFromNotification(response);
    }
  );

  // Cold-start tap: the listener above doesn't fire for the notification that
  // launched the app, so replay the last response once and route from it.
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    routeFromNotification(response);
  });

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
