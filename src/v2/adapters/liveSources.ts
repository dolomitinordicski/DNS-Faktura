import { FairAdapter, OrdersAdapter } from './sourceAdapters';
import {
  FirebaseFairBackend,
  FirebaseOrdersBackend,
} from './firebaseBackends';

export const firebaseOrdersSource = new OrdersAdapter(
  new FirebaseOrdersBackend(),
);

export const firebaseFairSource = new FairAdapter(
  new FirebaseFairBackend(),
);
