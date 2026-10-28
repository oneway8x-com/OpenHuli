#pragma once
#if defined(OPENHULI_LINK_CHECK)
#include "config.example.h"
#elif __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif
