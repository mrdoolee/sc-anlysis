import './styles.css';
import { debugHooks, start } from './ui/app.ts';

start();
(window as unknown as { __sta: typeof debugHooks }).__sta = debugHooks;
