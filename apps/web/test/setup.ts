import { configure } from '@testing-library/react';

// findBy/waitFor esperam até 5 s (o padrão é 1 s): o runner do CI é bem mais lento e as telas terminam transições assíncronas
configure({ asyncUtilTimeout: 5000 });
