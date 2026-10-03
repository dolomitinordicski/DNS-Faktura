import {
  CatalogPriceAdapter,
  FairAdapter,
  IdmAdapter,
  OrdersAdapter,
} from './sourceAdapters';
import {
  FirebaseCatalogPriceBackend,
  FirebaseFairBackend,
  FirebaseIdmBackend,
  FirebaseOrdersBackend,
} from './firebaseBackends';
import { CoreSeasonalExtraSource } from './seasonalExtras';

export const firebaseOrdersSource = new OrdersAdapter(
  new FirebaseOrdersBackend(),
);

export const firebaseFairSource = new FairAdapter(
  new FirebaseFairBackend(),
);


export const firebaseIdmSource = new IdmAdapter(
  new FirebaseIdmBackend(),
);

export const firebaseCatalogPriceSource = new CatalogPriceAdapter(
  new FirebaseCatalogPriceBackend(),
);


export const firebaseSeasonalExtraSource = new CoreSeasonalExtraSource();
