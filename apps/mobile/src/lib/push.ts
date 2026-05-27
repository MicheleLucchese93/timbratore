import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { api } from './api';

let registrationInFlight = false;

export async function registerPushTokenIfNeeded(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!Device.isDevice) return;
  if (registrationInFlight) return;
  registrationInFlight = true;
  try {
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ??
      (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResult.data;
    if (!token) return;
    await api('/api/v1/me', { method: 'PATCH', json: { push_token: token } });
  } catch (err) {
    console.warn('[sonoqui] push registration failed', err);
  } finally {
    registrationInFlight = false;
  }
}
