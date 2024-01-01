set(PkgTaef_Redist "C:/Code/Nuget/Taef.Redist.10.85.231027001-develop")

include_directories(${PkgTaef_Redist}/build/Include)
add_library(taef_tests SHARED taef1.cpp taef2.cpp)

set(TAEF_LIB_DIR ${PkgTaef_Redist}/build/Library/x64)
set(TAEF_LIBRARIES 
  ${TAEF_LIB_DIR}/Wex.Common.lib
  ${TAEF_LIB_DIR}/Wex.Logger.lib
  ${TAEF_LIB_DIR}/TE.Common.lib
)

target_link_libraries(taef_tests ${TAEF_LIBRARIES})