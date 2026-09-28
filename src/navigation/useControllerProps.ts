import { useEffect, useReducer } from 'react';

type SubscribableController<TProps> = {
  readonly props: TProps;
  subscribe(listener: () => void): () => void;
};

/** Subscribe once per stable controller instance and always reread its current props. */
export function useControllerProps<TProps>(controller: SubscribableController<TProps>): TProps {
  const [, rerender] = useReducer((value: number) => value + 1, 0);

  useEffect(() => controller.subscribe(() => rerender()), [controller]);

  return controller.props;
}
