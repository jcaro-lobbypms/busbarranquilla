import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class TripsRemoteSource {
  final Dio _dio;

  const TripsRemoteSource(this._dio);

  Future<Map<String, dynamic>> start(Map<String, dynamic> body) async {
    final response = await _dio.post(ApiPaths.tripStart, data: body);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> updateLocation(Map<String, dynamic> body) async {
    final response = await _dio.post(ApiPaths.tripLocation, data: body);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> end({Map<String, dynamic>? body}) async {
    final response = await _dio.post(ApiPaths.tripEnd, data: body ?? <String, dynamic>{});
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getCurrent() async {
    final response = await _dio.get(ApiPaths.tripCurrent);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getBuses() async {
    final response = await _dio.get(ApiPaths.tripBuses);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getHistory() async {
    final response = await _dio.get(ApiPaths.tripHistory);
    return response.data as Map<String, dynamic>;
  }

  Future<void> updateDestination(double lat, double lng, String? name) async {
    await _dio.patch(ApiPaths.tripDestination, data: <String, dynamic>{
      'latitude': lat,
      'longitude': lng,
      'name': name,
    });
  }
}
